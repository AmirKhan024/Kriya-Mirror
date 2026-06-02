/**
 * SupermanEngine — rep-based tracker for side-camera superman holds.
 *
 * The person lies face-down (prone), arms extended overhead, legs straight.
 * Each rep: chest and legs lift off the floor simultaneously (shoulder Y
 * rises = Y decreases in screen coords), then return.
 *
 * Primary metric: smoothedShoulderRise = max(0, baseline.shoulderMidY - smoothedShoulderY)
 *   0 at rest (prone on floor), 0.06+ at full lift.
 *
 * State machine:
 *   AT_REST → RISING → AT_TOP (stable 3+ frames) → LOWERING → AT_REST
 *
 * Warnings:
 *   'hip-lift-off'        — hip rises > 0.04 above calibrated floor during active rep
 *   'not-moving'          — 5 s idle at rest (Fix I + Fix P)
 *   'incomplete-superman' — peak shoulderRise < 0.06 at rep completion
 *   'malformed-rep'       — too-fast / ballistic / too-slow
 *   'position-lost'       — no usable pose frame for ≥ 3 s (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { SupermanCalibration } from './calibration';
import type {
  SupermanBaseline,
  SupermanEngineCallbacks,
  SupermanFrameMetrics,
  SupermanRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ---------------------------------------------------------------------------
// MediaPipe landmark indices (inline — avoids cross-module import issues)
// ---------------------------------------------------------------------------
const LEFT_SHOULDER  = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP       = 23;
const RIGHT_HIP      = 24;
const LEFT_KNEE      = 25;
const RIGHT_KNEE     = 26;
const LEFT_ANKLE     = 27;
const RIGHT_ANKLE    = 28;

function lmVisible(lm: { visibility?: number } | undefined): lm is { x: number; y: number; visibility: number } {
  return (lm?.visibility ?? 0) > 0.5;
}

// ---------------------------------------------------------------------------
// Tunable constants (verbatim from task spec)
// ---------------------------------------------------------------------------
const EMA_ALPHA = 0.20;

const RISE_ENTER_THRESHOLD = 0.03;  // smoothedShoulderRise > this → begin RISING
const AT_TOP_THRESHOLD = 0.06;      // smoothedShoulderRise >= this → AT_TOP candidate
const RETURN_THRESHOLD = 0.025;     // smoothedShoulderRise < this (raw) → back to AT_REST
const AT_TOP_STABILITY_FRAMES = 3;  // frames above AT_TOP_THRESHOLD to confirm AT_TOP

const MIN_SHOULDER_RISE = 0.06;     // peak must exceed this for a valid rep

// Hip-lift gate
const HIP_LIFT_THRESHOLD     = 0.04;  // normalised Y units (screen y=0 is top)
const HIP_LIFT_DEBOUNCE_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle detection (Fix I + Fix P)
const NO_MOVEMENT_TIMEOUT_MS  = 5000;
const NO_MOVEMENT_VARIANCE = 0.01;
const NO_MOVEMENT_REPEAT_MS   = 15000;

// Rep validity
const MIN_REP_DURATION_MS = 400;
const MAX_REP_DURATION_MS = 8000;
const MAX_SHOULDER_VELOCITY = 3.0;

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS  = 10_000;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export class SupermanEngine {
  private callbacks: SupermanEngineCallbacks;
  private calibration: SupermanCalibration;
  private baseline: SupermanBaseline | null = null;

  private repState: SupermanRepState = 'AT_REST';
  private smoothedShoulderY = 0;    // EMA of raw shoulder mid Y
  private prevSmoothedShoulderY = 0;
  private smoothedShoulderRise = 0; // max(0, baseline.shoulderMidY - smoothedShoulderY)
  private rawShoulderY = 0;         // current raw shoulder mid Y
  private rawShoulderRise = 0;      // un-smoothed, for RETURN_THRESHOLD check
  private maxRiseThisRep = 0;
  private repShoulderVelocities: number[] = [];
  private repFormCounts = { hipOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevShoulderY = 0;
  private prevShoulderTimestamp = 0;

  private repStartedAt = 0;

  // AT_TOP stability gate
  private atTopFrames = 0;

  // Idle detection (Fix I + Fix P)
  private restSince = 0;
  private restRiseMin = Infinity;
  private restRiseMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  // Fix O: EMA reseed after post-rep decay settles
  private restSettledSince = 0;
  private restBaselineReseeded = false;

  // Hip-lift debounce
  private hipLiftFrames = 0;

  // Fix N: position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: SupermanEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SupermanCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Initialize idle tracking on cal-confirm (prevents instant not-moving)
        this.restSince = now;
        this.restRiseMin = this.smoothedShoulderRise;
        this.restRiseMax = this.smoothedShoulderRise;
        this.restSettledSince = 0;
        this.restBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('SUPERMAN', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            bodyLength: +this.baseline.bodyLength.toFixed(3),
            hipY: +this.baseline.hipY.toFixed(3),
            shoulderMidY: +this.baseline.shoulderMidY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: post-cal position-lost check runs regardless of landmark validity
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'AT_REST';
    this.smoothedShoulderY = 0;
    this.prevSmoothedShoulderY = 0;
    this.smoothedShoulderRise = 0;
    this.rawShoulderRise = 0;
    this.resetRepBuffers();
  }

  // ---------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh  = landmarks[LEFT_HIP];
    const rh  = landmarks[RIGHT_HIP];
    const lk  = landmarks[LEFT_KNEE];
    const rk  = landmarks[RIGHT_KNEE];
    const la  = landmarks[LEFT_ANKLE];
    const ra  = landmarks[RIGHT_ANKLE];
    const ls  = landmarks[LEFT_SHOULDER];
    const rs  = landmarks[RIGHT_SHOULDER];

    // coreOk already checked by hasCoreLandmarks, but guard for type safety
    if (!lmVisible(lh) || !lmVisible(rh) || !lmVisible(lk) || !lmVisible(rk)
        || !lmVisible(la) || !lmVisible(ra) || !lmVisible(ls) || !lmVisible(rs)) {
      return;
    }

    // Primary signal: shoulder mid Y (average of both shoulders)
    const rawShoulderY = (ls.y + rs.y) / 2;
    this.rawShoulderY = rawShoulderY;

    // EMA smoothing — seed with first real value
    this.smoothedShoulderY = this.smoothedShoulderY === 0
      ? rawShoulderY
      : EMA_ALPHA * rawShoulderY + (1 - EMA_ALPHA) * this.smoothedShoulderY;

    // shoulderRise = how much the shoulder has lifted from baseline
    // In screen coords y=0 is top, so rising = y decreasing = baseline.shoulderMidY - currentY
    this.smoothedShoulderRise = Math.max(0, baseline.shoulderMidY - this.smoothedShoulderY);
    this.rawShoulderRise = Math.max(0, baseline.shoulderMidY - rawShoulderY);

    // Shoulder Y velocity — for ballistic detection
    if (this.prevShoulderTimestamp > 0) {
      const dt = (now - this.prevShoulderTimestamp) / 1000;
      if (dt > 0) {
        const v = (rawShoulderY - this.prevShoulderY) / dt;
        if (this.repState === 'RISING' || this.repState === 'LOWERING') {
          this.repShoulderVelocities.push(v);
        }
      }
    }
    this.prevShoulderY = rawShoulderY;
    this.prevShoulderTimestamp = now;

    // Hip Y average
    const avgHipY = (lh.y + rh.y) / 2;

    // Hip-lift detection: in screen coords y=0 is top.
    // "Hip lifted off mat" means avgHipY moved upward (smaller y).
    // Check: (baseline.hipY - avgHipY) > HIP_LIFT_THRESHOLD
    const hipLiftRaw = (baseline.hipY - avgHipY) > HIP_LIFT_THRESHOLD;
    this.hipLiftFrames = hipLiftRaw ? this.hipLiftFrames + 1 : 0;
    const hipLiftWarn = this.hipLiftFrames >= HIP_LIFT_DEBOUNCE_FRAMES;

    // Form accumulation during active phases
    const inActiveRep = this.repState !== 'AT_REST';
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!hipLiftWarn) this.repFormCounts.hipOKCount++;
    }

    if (hipLiftWarn) this.repWarnings.add('hip-lift-off');

    // Fix A: only coach form during the active rep phase
    if (inActiveRep) {
      this.maybeEmitWarning('hip-lift-off', hipLiftWarn, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: SupermanFrameMetrics = {
      shoulderRise: this.smoothedShoulderRise,
      repState: this.repState,
      hipLiftAmount: Math.max(0, baseline.hipY - avgHipY),
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedShoulderY = this.smoothedShoulderY;
  }

  // ---------------------------------------------------------------------------
  // Superman uses a 4-state machine with AT_TOP stability gate.
  // AT_REST → RISING → AT_TOP (stable) → LOWERING → AT_REST
  // ---------------------------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'AT_REST':
        if (this.smoothedShoulderRise > RISE_ENTER_THRESHOLD) {
          this.repState = 'RISING';
          // Fix C: reset FIRST, then set repStartedAt (resetRepBuffers zeros it)
          this.resetRepBuffers();
          this.repStartedAt = now;
          this.atTopFrames = 0;
          debugLog('SUPERMAN', 'STATE', 'AT_REST → RISING', {
            rise: +this.smoothedShoulderRise.toFixed(3),
          });
        }
        break;

      case 'RISING': {
        this.maxRiseThisRep = Math.max(this.maxRiseThisRep, this.smoothedShoulderRise);
        if (this.smoothedShoulderRise >= AT_TOP_THRESHOLD) {
          this.atTopFrames++;
          if (this.atTopFrames >= AT_TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('SUPERMAN', 'STATE', 'RISING → AT_TOP', {
              rise: +this.smoothedShoulderRise.toFixed(3),
              peak: +this.maxRiseThisRep.toFixed(3),
            });
          }
        } else {
          this.atTopFrames = 0;
          // Check for early reversal: if rise starts dropping significantly
          // from peak before reaching AT_TOP, transition directly to LOWERING
          const dropFromPeak = this.maxRiseThisRep - this.smoothedShoulderRise;
          if (dropFromPeak >= 0.02 && this.maxRiseThisRep > RISE_ENTER_THRESHOLD) {
            this.repState = 'LOWERING';
            debugLog('SUPERMAN', 'STATE', 'RISING → LOWERING (early reversal)', {
              peak: +this.maxRiseThisRep.toFixed(3),
              dropFromPeak: +dropFromPeak.toFixed(3),
            });
          }
        }
        break;
      }

      case 'AT_TOP': {
        this.maxRiseThisRep = Math.max(this.maxRiseThisRep, this.smoothedShoulderRise);
        // Transition to LOWERING when rise drops below AT_TOP_THRESHOLD
        if (this.smoothedShoulderRise < AT_TOP_THRESHOLD) {
          this.repState = 'LOWERING';
          debugLog('SUPERMAN', 'STATE', 'AT_TOP → LOWERING', {
            rise: +this.smoothedShoulderRise.toFixed(3),
          });
        }
        break;
      }

      case 'LOWERING':
        // Use RAW rise (not EMA-smoothed) for the return-to-rest check.
        // EMA lag would prevent the smoothed from reaching near-zero in normal
        // 1–2 second rep cycles, causing reps to never complete.
        if (this.rawShoulderRise < RETURN_THRESHOLD) {
          this.completeRep(now);
          this.repState = 'AT_REST';
          // Reset EMA to current raw so next rep starts from accurate baseline.
          this.smoothedShoulderY     = this.rawShoulderY;
          this.prevSmoothedShoulderY = this.rawShoulderY;
          this.smoothedShoulderRise  = 0;
          this.restSince = now;
          this.restRiseMin = Infinity;
          this.restRiseMax = -Infinity;
          this.restSettledSince = 0;
          this.restBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 1. Too shallow — primary quality gate
    if (this.maxRiseThisRep < MIN_SHOULDER_RISE) {
      return { ok: false, reason: 'too-shallow' };
    }
    // 2. Too fast (ballistic by duration)
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    // 3. Ballistic by velocity
    if (this.repShoulderVelocities.length > 0) {
      const peakV = Math.max(...this.repShoulderVelocities.map(Math.abs));
      if (peakV > MAX_SHOULDER_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    // 4. Too slow — hesitation / stuck mid-rep
    if (this.repStartedAt > 0 && now - this.repStartedAt > MAX_REP_DURATION_MS) {
      return { ok: false, reason: 'too-slow' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('SUPERMAN', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakRise: +this.maxRiseThisRep.toFixed(3),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-superman', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness  = getSmoothnessScore(this.repShoulderVelocities);
    const form        = getFormScore(this.repFormCounts);
    const completion  = getCompletionScore(this.maxRiseThisRep);
    const mqs         = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg:   Math.round(this.maxRiseThisRep * 1000) / 1000,
      smoothness: Math.round(smoothness),
      form:       Math.round(form),
      mqs:        Math.round(mqs),
      warnings:   Array.from(this.repWarnings),
    };
    debugLog('SUPERMAN', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ---------------------------------------------------------------------------
  // Idle detection (Fix I + Fix P + Fix O)
  // ---------------------------------------------------------------------------
  private checkNoMovement(now: number): void {
    if (this.repState !== 'AT_REST') {
      // Active rep — reset idle baseline
      this.restSince = now;
      this.restRiseMin = this.smoothedShoulderRise;
      this.restRiseMax = this.smoothedShoulderRise;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
      return;
    }

    if (this.smoothedShoulderRise < this.restRiseMin) this.restRiseMin = this.smoothedShoulderRise;
    if (this.smoothedShoulderRise > this.restRiseMax) this.restRiseMax = this.smoothedShoulderRise;

    // Fix O: re-baseline once the post-rep EMA decay has settled (< 0.001/frame
    // for 500 ms), so the decay tail doesn't permanently inflate min-max and
    // prevent the not-moving warning from ever firing.
    if (!this.restBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedShoulderRise - Math.max(0, this.baseline!.shoulderMidY - this.prevSmoothedShoulderY));
      const emaShift = Math.abs(this.smoothedShoulderY - this.prevSmoothedShoulderY);
      if (emaShift < 0.003) {
        if (this.restSettledSince === 0) this.restSettledSince = now;
        if (now - this.restSettledSince >= 500) {
          this.restRiseMin = this.smoothedShoulderRise;
          this.restRiseMax = this.smoothedShoulderRise;
          this.restSince = now;
          this.restBaselineReseeded = true;
        }
      } else {
        this.restSettledSince = 0;
      }
    }

    const idleMs   = now - this.restSince;
    const variance = this.restRiseMax - this.restRiseMin;

    // Cold-start fix: treat lastNoMovementWarnAt === 0 as "never fired", so
    // the first warning fires even when now < NO_MOVEMENT_REPEAT_MS.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS && variance < NO_MOVEMENT_VARIANCE && firstFireAllowed) {
      this.lastNoMovementWarnAt = now;
      debugLog('SUPERMAN', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        riseVariance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.restSince = now;
      this.restRiseMin = this.smoothedShoulderRise;
      this.restRiseMax = this.smoothedShoulderRise;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Fix N: position-lost detection
  // ---------------------------------------------------------------------------

  /** Same landmark set as processTrackingFrame's coreOk check. */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LEFT_HIP])  && lmVisible(landmarks[RIGHT_HIP])
      && lmVisible(landmarks[LEFT_KNEE])   && lmVisible(landmarks[RIGHT_KNEE])
      && lmVisible(landmarks[LEFT_ANKLE])  && lmVisible(landmarks[RIGHT_ANKLE])
      && lmVisible(landmarks[LEFT_SHOULDER])  && lmVisible(landmarks[RIGHT_SHOULDER]);
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
    debugLog('SUPERMAN', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ---------------------------------------------------------------------------
  private resetRepBuffers(): void {
    this.maxRiseThisRep = 0;
    this.repShoulderVelocities = [];
    this.repFormCounts       = { hipOKCount: 0, totalCount: 0 };
    this.repWarnings         = new Set();
    this.repStartedAt        = 0;
    this.hipLiftFrames       = 0;
    this.atTopFrames         = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('SUPERMAN', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
