/**
 * StepUpEngine — rep-based tracker for front-camera Step-Up.
 *
 * State machine (4 states — simpler than jump-squat):
 *   STANDING   (hipRise < STANDING_TOLERANCE)
 *   → ASCENDING  (smoothedHipRise > STEP_ENTER_THRESHOLD)
 *   → AT_TOP     (smoothedHipRise > AT_TOP_THRESHOLD, stable 5 frames)
 *   → DESCENDING (drop from peak > DESCENT_FROM_PEAK)
 *   → STANDING   (hipRise < STANDING_TOLERANCE) → REP COMPLETE
 *
 * Warnings (Fix A–R applied):
 *   - incomplete-step-up  — peak hipRise < MIN_HIP_RISE at rep close (new)
 *   - valgus              — lead knee collapses inward > 20% (Fix A gated)
 *   - trunk-forward       — trunk lean > 40° (Fix A gated)
 *   - malformed-rep       — jitter spike or too-short duration
 *   - not-moving          — 5s idle post-calibration (Fix I + Fix P + Fix O)
 *   - position-lost       — no usable landmarks ≥ 3s post-calibration (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, trunkLeanDeg } from './geometry';
import { StepUpCalibration } from './calibration';
import type { StepUpBaseline, StepUpEngineCallbacks, StepUpFrameMetrics, StepUpRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// EMA for bilateral hip Y smoothing
const EMA_ALPHA_HIP = 0.20;

// State machine thresholds (normalised Y units, 0..1 frame height)
const STEP_ENTER_THRESHOLD = 0.04;    // hipRise > this → ASCENDING
const AT_TOP_THRESHOLD = 0.12;        // hipRise > this → AT_TOP candidate
const AT_TOP_STABILITY_FRAMES = 5;    // frames above AT_TOP_THRESHOLD to confirm AT_TOP
const DESCENT_FROM_PEAK = 0.04;       // hipRise drops by this from peak → DESCENDING
const STANDING_TOLERANCE = 0.04;      // hipRise < this AND was AT_TOP → rep complete

// Rep validation
const MIN_HIP_RISE = 0.10;            // peak must exceed this for a valid rep
const MIN_REP_DURATION_MS = 800;      // step-ups are slow
// Fix R: MAX_HIP_VELOCITY high — noise rejection only
const MAX_HIP_VELOCITY = 3.0;

// Form warnings
const VALGUS_THRESHOLD_RATIO = 0.20;  // knee collapse inward > 20% vs baseline
const VALGUS_DEBOUNCE_FRAMES = 10;
const TRUNK_WARN_DEG = 40;            // excessive forward lean
const TRUNK_DEBOUNCE_FRAMES = 6;

// Cross-cutting
const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.01;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position-lost
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class StepUpEngine {
  private callbacks: StepUpEngineCallbacks;
  private calibration: StepUpCalibration;
  private baseline: StepUpBaseline | null = null;

  private repState: StepUpRepState = 'STANDING';
  private smoothedHipY = 0;
  private prevSmoothedHipY = 0;
  private prevHipY = 0;
  private prevTimestamp = 0;

  // AT_TOP stability counter
  private atTopFrameCount = 0;

  // Rep tracking
  private repStartedAt = 0;
  private maxHipRiseThisRep = 0;
  private peakHipRiseAtTop = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { valgusOkCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Lead leg detection
  private leadLeg: 'left' | 'right' = 'left';
  private leadLegDetermined = false;

  // Valgus debounce (Fix A)
  private valgusFrameCount = 0;
  private valgusFired = false;

  // Trunk debounce (Fix A)
  private trunkBadFrameCount = 0;
  private trunkFired = false;

  // Idle detection (Fix I + Fix O + Fix P)
  private standingSince = 0;
  private standingHipYMin = Infinity;
  private standingHipYMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Guard against immediate re-entry after aborted rep fallback
  private repFallbackCooldownUntil = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: StepUpEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new StepUpCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I + Fix P: seed idle tracking on cal-confirm
        this.standingSince = now;
        this.standingHipYMin = this.smoothedHipY;
        this.standingHipYMax = this.smoothedHipY;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('STEP-UP', 'CALIB', 'CONFIRMED', {
            hipY: +this.baseline.hipY.toFixed(3),
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: check position-lost BEFORE the null early-return
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedHipY = 0;
    this.prevSmoothedHipY = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];

    if (!lmVisible(lh) || !lmVisible(rh) || !lmVisible(lk) || !lmVisible(rk)
      || !lmVisible(la) || !lmVisible(ra)) return;

    const hipMid = midpoint(lh, rh);
    const rawHipY = hipMid.y;

    // Fix R (EMA init branch): first frame sets value directly
    this.smoothedHipY = this.smoothedHipY === 0
      ? rawHipY
      : EMA_ALPHA_HIP * rawHipY + (1 - EMA_ALPHA_HIP) * this.smoothedHipY;

    // Hip Y velocity (normalised Y / second)
    // Negative = moving up (stepping up). Positive = moving down (descending).
    let hipVelocityPerFrame = 0;
    if (this.prevTimestamp > 0) {
      const dt = (now - this.prevTimestamp) / 1000;
      if (dt > 0) {
        hipVelocityPerFrame = (rawHipY - this.prevHipY) / dt;
        if (this.repState !== 'STANDING') {
          this.repHipVelocities.push(hipVelocityPerFrame);
        }
      }
    }
    this.prevHipY = rawHipY;
    this.prevTimestamp = now;

    // hipRise: positive when hips are ABOVE baseline (person is stepping up)
    const hipRise = baseline.hipY - rawHipY;
    const smoothedHipRise = baseline.hipY - this.smoothedHipY;

    // Track max hip rise during rep
    if (this.repState !== 'STANDING' && hipRise > this.maxHipRiseThisRep) {
      this.maxHipRiseThisRep = hipRise;
    }

    // Trunk lean check (Fix A: gated to active rep)
    const inActiveRep = this.repState !== 'STANDING';
    let trunkBad = false;
    if (inActiveRep && lmVisible(ls) && lmVisible(rs)) {
      const trunkDeg = trunkLeanDeg(midpoint(ls, rs), hipMid);
      trunkBad = trunkDeg > TRUNK_WARN_DEG;
    }

    // Trunk debounce
    if (inActiveRep && trunkBad) {
      this.trunkBadFrameCount++;
      if (this.trunkBadFrameCount >= TRUNK_DEBOUNCE_FRAMES && !this.trunkFired) {
        this.trunkFired = true;
        this.repWarnings.add('trunk-forward');
        this.maybeEmitWarning('trunk-forward', true, now);
      }
    } else {
      this.trunkBadFrameCount = 0;
    }

    // Valgus check (Fix A: gated to active rep, lead leg only)
    let valgusLead = false;
    if (inActiveRep && this.leadLegDetermined) {
      const leadKnee = this.leadLeg === 'left' ? lk : rk;
      const baselineLeadKneeX = this.leadLeg === 'left' ? baseline.leftKneeX : baseline.rightKneeX;
      const kneeDeviation = Math.abs(leadKnee.x - baselineLeadKneeX) / (baseline.shoulderWidth || 0.1);
      valgusLead = kneeDeviation > VALGUS_THRESHOLD_RATIO;
    }

    // Valgus debounce
    if (inActiveRep && valgusLead) {
      this.valgusFrameCount++;
      if (this.valgusFrameCount >= VALGUS_DEBOUNCE_FRAMES && !this.valgusFired) {
        this.valgusFired = true;
        this.repWarnings.add('valgus');
        this.maybeEmitWarning('valgus', true, now);
      }
    } else {
      this.valgusFrameCount = 0;
    }

    // Form accumulation
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!valgusLead) {
        this.repFormCounts.valgusOkCount++;
      }
    }

    this.checkNoMovement(now);
    this.advanceRepState(smoothedHipRise, hipRise, hipVelocityPerFrame, lk, rk, now);

    const metrics: StepUpFrameMetrics = {
      hipY: rawHipY,
      smoothedHipY: this.smoothedHipY,
      hipRise,
      repState: this.repState,
      valgusLead,
      trunkBad,
    };
    this.callbacks.onFrame?.(metrics);

    this.prevSmoothedHipY = this.smoothedHipY;
  }

  // ----------------------------------------------------------
  private advanceRepState(
    smoothedHipRise: number,
    rawHipRise: number,
    hipVelocity: number,
    lk: { x: number; y: number; visibility?: number },
    rk: { x: number; y: number; visibility?: number },
    now: number,
  ): void {
    const baseline = this.baseline!;

    switch (this.repState) {
      case 'STANDING':
        if (smoothedHipRise > STEP_ENTER_THRESHOLD && now >= this.repFallbackCooldownUntil) {
          // Determine lead leg: lower knee Y = that knee is higher in frame = lead leg
          this.leadLeg = lk.y < rk.y ? 'left' : 'right';
          this.leadLegDetermined = true;

          this.repState = 'ASCENDING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.leadLeg = lk.y < rk.y ? 'left' : 'right';
          this.leadLegDetermined = true;
          this.repStartedAt = now;
          debugLog('STEP-UP', 'STATE', 'STANDING → ASCENDING', {
            smoothedHipRise: +smoothedHipRise.toFixed(3),
            leadLeg: this.leadLeg,
          });
        }
        break;

      case 'ASCENDING':
        if (smoothedHipRise > this.maxHipRiseThisRep) {
          this.maxHipRiseThisRep = smoothedHipRise;
        }
        if (smoothedHipRise > AT_TOP_THRESHOLD) {
          this.atTopFrameCount++;
          if (this.atTopFrameCount >= AT_TOP_STABILITY_FRAMES) {
            this.peakHipRiseAtTop = this.maxHipRiseThisRep;
            this.repState = 'AT_TOP';
            this.atTopFrameCount = 0;
            debugLog('STEP-UP', 'STATE', 'ASCENDING → AT_TOP', {
              peakHipRise: +this.peakHipRiseAtTop.toFixed(3),
            });
          }
        } else {
          this.atTopFrameCount = 0;
          // Fallback: aborted ascending — hip peaked and returned to standing without
          // confirming AT_TOP (too-fast or too-shallow rep).
          // Use smoothedHipRise to avoid raw-noise false triggers.
          if (this.maxHipRiseThisRep > STEP_ENTER_THRESHOLD && smoothedHipRise < STANDING_TOLERANCE) {
            debugLog('STEP-UP', 'STATE', 'ASCENDING → STANDING (aborted)', {
              peakRise: +this.maxHipRiseThisRep.toFixed(3),
            });
            this.completeRep(now);
            this.repState = 'STANDING';
            this.standingSince = now;
            this.standingHipYMin = Infinity;
            this.standingHipYMax = -Infinity;
            this.standingSettledSince = 0;
            this.standingBaselineReseeded = false;
            // Cooldown: prevent immediate STANDING→ASCENDING re-entry (EMA decay lag)
            this.repFallbackCooldownUntil = now + 1000;
          }
        }
        break;

      case 'AT_TOP':
        if (smoothedHipRise > this.maxHipRiseThisRep) {
          this.maxHipRiseThisRep = smoothedHipRise;
          this.peakHipRiseAtTop = smoothedHipRise;
        }
        // Transition to DESCENDING when drop from peak exceeds threshold
        if (this.peakHipRiseAtTop - smoothedHipRise > DESCENT_FROM_PEAK) {
          this.repState = 'DESCENDING';
          debugLog('STEP-UP', 'STATE', 'AT_TOP → DESCENDING', {
            peak: +this.peakHipRiseAtTop.toFixed(3),
            current: +smoothedHipRise.toFixed(3),
          });
        }
        break;

      case 'DESCENDING':
        // Use smoothedHipRise (not raw) to ensure EMA has settled before declaring STANDING.
        // This prevents immediate STANDING→ASCENDING re-entry due to EMA lag.
        if (smoothedHipRise < STANDING_TOLERANCE) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHipYMin = Infinity;
          this.standingHipYMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
          debugLog('STEP-UP', 'STATE', 'DESCENDING → STANDING (rep complete)', {
            hipVelocity: +hipVelocity.toFixed(3),
          });
        }
        break;
    }
  }

  private validateRepShape(now: number): {
    ok: boolean;
    reason?: string;
    warnings: WarningType[];
  } {
    // Jitter spike (data unusable — check first)
    if (this.repHipVelocities.length > 0) {
      const peakVAbs = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakVAbs > MAX_HIP_VELOCITY) {
        return { ok: false, reason: 'ballistic', warnings: [] };
      }
    }

    // incomplete-step-up before too-fast: more actionable feedback
    if (this.maxHipRiseThisRep < MIN_HIP_RISE) {
      return { ok: false, reason: 'incomplete-step-up', warnings: [] };
    }

    // Duration gate
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast', warnings: [] };
    }

    return { ok: true, warnings: [] };
  }

  private completeRep(now: number): void {
    const durationMs = this.repStartedAt > 0 ? Math.round(now - this.repStartedAt) : 0;
    const maxRise = this.maxHipRiseThisRep;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      debugLog('STEP-UP', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        maxRise: +maxRise.toFixed(3),
        durationMs,
      });
      if (validation.reason === 'incomplete-step-up') {
        this.maybeEmitWarning('incomplete-step-up', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    for (const w of validation.warnings) {
      this.repWarnings.add(w);
      this.maybeEmitWarning(w, true, now);
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(maxRise);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(maxRise * 1000) / 1000,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('STEP-UP', 'REP', 'Rep complete', {
      ...repPayload,
      durationMs,
      maxRise: +maxRise.toFixed(3),
    });
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // Fix I + Fix O + Fix P
  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingHipYMin = this.smoothedHipY;
      this.standingHipYMax = this.smoothedHipY;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedHipY < this.standingHipYMin) this.standingHipYMin = this.smoothedHipY;
    if (this.smoothedHipY > this.standingHipYMax) this.standingHipYMax = this.smoothedHipY;

    // Fix O: re-baseline once EMA has settled post-rep
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedHipY - this.prevSmoothedHipY);
      if (emaDelta < 0.002) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingHipYMin = this.smoothedHipY;
          this.standingHipYMax = this.smoothedHipY;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    const idleMs = now - this.standingSince;
    const variance = this.standingHipYMax - this.standingHipYMin;
    // Fix P: cold-start cooldown
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('STEP-UP', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingHipYMin = this.smoothedHipY;
      this.standingHipYMax = this.smoothedHipY;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.repStartedAt = 0;
    this.maxHipRiseThisRep = 0;
    this.peakHipRiseAtTop = 0;
    this.atTopFrameCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { valgusOkCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.valgusFrameCount = 0;
    this.valgusFired = false;
    this.trunkBadFrameCount = 0;
    this.trunkFired = false;
    this.leadLegDetermined = false;
    // Note: repFallbackCooldownUntil is NOT reset here — it must persist across rep boundaries
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('STEP-UP', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE]);
  }

  private checkPositionLost(haveValidFrame: boolean, now: number): void {
    if (haveValidFrame) {
      this.lastValidFrameAt = now;
      return;
    }
    const lostMs = now - this.lastValidFrameAt;
    if (lostMs < POSITION_LOST_TIMEOUT_MS) return;
    const firstFireAllowed = this.lastPositionLostWarnAt === 0
      || now - this.lastPositionLostWarnAt >= POSITION_LOST_REPEAT_MS;
    if (!firstFireAllowed) return;
    this.lastPositionLostWarnAt = now;
    debugLog('STEP-UP', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
