/**
 * StarJumpEngine — bilateral arm-elevation tracker for front-camera Star Jump
 * (Jumping Jack).
 *
 * Primary signal: wristDelta = shoulderY - avgWristY
 *   Arms at sides → wristDelta ≈ -0.20 (wrists far below shoulders)
 *   Arms at shoulder level → wristDelta ≈ 0
 *   Arms fully overhead → wristDelta ≈ +0.15 to +0.25
 *
 * State machine:
 *   DOWN     (smoothedDelta < DOWN_THRESHOLD — arms at rest)
 *   RAISING  (smoothedDelta rising past RAISE_ENTER_THRESHOLD)
 *   AT_TOP   (smoothedDelta > AT_TOP_THRESHOLD, stable 4+ frames)
 *   LOWERING (arms descending back toward sides)
 *   DOWN     (rep complete when smoothedDelta < DOWN_RETURN_THRESHOLD)
 *
 * Posture warnings:
 *   incomplete-star-jump — peak wristDelta < MIN_REP_PEAK_DELTA (arms never overhead)
 *   malformed-rep        — bilateral asymmetry / too-fast / ballistic velocity
 *   not-moving           — 5s idle in DOWN state
 *   position-lost        — no usable frame ≥ 3s post-cal
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, torsoSwingDelta } from './geometry';
import { StarJumpCalibration } from './calibration';
import type {
  StarJumpBaseline, StarJumpEngineCallbacks, StarJumpFrameMetrics, StarJumpRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ── EMA ──────────────────────────────────────────────────────────────────────
const EMA_ALPHA = 0.15;

// ── State machine thresholds (wristDelta = shoulderY - wristMidY) ────────────
const DOWN_THRESHOLD = -0.06;         // wrist must be this far below shoulder to be in DOWN
const RAISE_ENTER_THRESHOLD = -0.02;  // rising past this triggers RAISING
const AT_TOP_THRESHOLD = 0.08;        // wrists clearly overhead — enter AT_TOP
const AT_TOP_STABILITY_FRAMES = 4;
const AT_TOP_STABILITY_DELTA = 0.02;
const LOWERING_DROP_FROM_PEAK = 0.04;  // drop from peak delta to leave AT_TOP → LOWERING
const DOWN_RETURN_THRESHOLD = -0.06;   // rep complete when returning below this

// ── Rep validation ────────────────────────────────────────────────────────────
// MIN_REP_PEAK_DELTA = 0.12: wrists must reach clearly overhead (~118° raise).
// Must be > AT_TOP_THRESHOLD (0.08) so that reps entering AT_TOP but barely
// overhead still trigger incomplete-star-jump (arms only to ~105-115° is poor form).
const MIN_REP_PEAK_DELTA = 0.12;
const MIN_REP_DURATION_MS = 300;
// Fix R: wrist-tracking ballistic threshold. Same physical-test tuning as
// bicep-curl — large wrist arc, regular reps can spike v if too low.
const MAX_WRIST_VELOCITY = 4.0;
// Bilateral symmetry: both arms must reach ≥ 60% of each other's peak.
// More lenient than bicep-curl (0.7) since star-jump asymmetry is common.
const MIN_BILATERAL_SYMMETRY = 0.60;

// ── Form warnings ─────────────────────────────────────────────────────────────
const TORSO_SWING_THRESHOLD = 0.03;
const TORSO_SWING_DEBOUNCE_FRAMES = 6;
// Leg spread OK: ankleWidth / baseline.shoulderWidth ≥ this during active phase
const LEG_SPREAD_OK_RATIO = 1.20;

// ── Idle detection ────────────────────────────────────────────────────────────
const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.01;    // normalised wristDelta units
const NO_MOVEMENT_REPEAT_MS = 15000;

// ── Position-lost ─────────────────────────────────────────────────────────────
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class StarJumpEngine {
  private callbacks: StarJumpEngineCallbacks;
  private calibration: StarJumpCalibration;
  private baseline: StarJumpBaseline | null = null;

  private repState: StarJumpRepState = 'DOWN';
  private smoothedWristDelta = 0;
  private prevSmoothedWristDelta = 0;
  private stableTopCount = 0;
  private peakWristDelta = -Infinity;

  // Per-arm peak tracking (bilateral symmetry — Fix B/D)
  private peakDeltaLeft = -Infinity;
  private peakDeltaRight = -Infinity;

  // Wrist Y velocity for smoothness score (Fix R: track distal wrist — large arc)
  private repWristVelocities: number[] = [];
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  private repStartedAt = 0;
  private repFormCounts = { torsoOKCount: 0, legSpreadOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Idle detection in DOWN state (Fix O: post-rep EMA-decay reseed)
  private downSince = 0;
  private downDeltaMin = Infinity;
  private downDeltaMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private downSettledSince = 0;
  private downBaselineReseeded = false;

  // Position-lost heartbeat (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counters
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: StarJumpEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new StarJumpCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix §3.7: seed idle tracking on cal-confirm. Without this the
        // construction-time-0 causes an instant false-positive 'not-moving'.
        this.downSince = now;
        this.downDeltaMin = this.smoothedWristDelta;
        this.downDeltaMax = this.smoothedWristDelta;
        this.downSettledSince = 0;
        this.downBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat on cal-confirm.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('STAR_JUMP', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            shoulderMidX: +this.baseline.shoulderMidX.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs regardless of frame quality.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'DOWN';
    this.smoothedWristDelta = 0;
    this.prevSmoothedWristDelta = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lw) && lmVisible(rw)
      && lmVisible(la) && lmVisible(ra);
    if (!coreOk) return;

    const shoulderMid = midpoint(ls, rs);
    const shoulderMidY = shoulderMid.y;

    // Bilateral wrist deltas (shoulderY - wristY; positive = wrist above shoulder)
    const leftWristDelta = shoulderMidY - lw.y;
    const rightWristDelta = shoulderMidY - rw.y;
    const rawWristDelta = (leftWristDelta + rightWristDelta) / 2;

    // Fix B10: EMA init on first frame — use raw value directly to avoid the
    // EMA drifting up from 0 through the rep-start zone on cold-start.
    this.smoothedWristDelta = this.smoothedWristDelta === 0
      ? rawWristDelta
      : EMA_ALPHA * rawWristDelta + (1 - EMA_ALPHA) * this.smoothedWristDelta;

    // Wrist Y velocity (drives smoothness — wrists travel the largest arc)
    const wristMidY = (lw.y + rw.y) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wristMidY - this.prevWristY) / dt;
        if (this.repState === 'RAISING' || this.repState === 'LOWERING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wristMidY;
    this.prevWristTimestamp = now;

    // Torso swing — shoulder midpoint X deviates from baseline
    const torsoSwingActive = torsoSwingDelta(shoulderMid.x, baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Leg spread during active phase (for form score)
    const liveAnkleWidth = Math.abs(la.x - ra.x);
    const legSpreadRatio = baseline.shoulderWidth > 0 ? liveAnkleWidth / baseline.shoulderWidth : 1;
    const legSpreadOK = legSpreadRatio >= LEG_SPREAD_OK_RATIO;

    // Bilateral per-frame symmetry check (for form score)
    const leftDeltaAbs = Math.max(0, leftWristDelta);
    const rightDeltaAbs = Math.max(0, rightWristDelta);
    const deltaSum = leftDeltaAbs + rightDeltaAbs;
    const symmetryOK = deltaSum < 0.02 || (
      Math.min(leftDeltaAbs, rightDeltaAbs) / Math.max(leftDeltaAbs, rightDeltaAbs) >= MIN_BILATERAL_SYMMETRY
    );

    // Form accumulation during active phases (Fix A: gate to non-DOWN state)
    if (this.repState !== 'DOWN') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (legSpreadOK) this.repFormCounts.legSpreadOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    // Per-rep bilateral peak tracking
    if (this.repState !== 'DOWN') {
      if (leftWristDelta > this.peakDeltaLeft) this.peakDeltaLeft = leftWristDelta;
      if (rightWristDelta > this.peakDeltaRight) this.peakDeltaRight = rightWristDelta;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: StarJumpFrameMetrics = {
      wristDelta: rawWristDelta,
      smoothedWristDelta: this.smoothedWristDelta,
      repState: this.repState,
      leftWristDelta,
      rightWristDelta,
      legSpreadRatio,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedWristDelta = this.smoothedWristDelta;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'DOWN':
        if (this.smoothedWristDelta > RAISE_ENTER_THRESHOLD) {
          this.repState = 'RAISING';
          // Fix C: reset FIRST, then set repStartedAt. resetRepBuffers() zeros
          // repStartedAt — calling it AFTER the assignment loses the timestamp.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('STAR_JUMP', 'STATE', 'DOWN → RAISING', { delta: +this.smoothedWristDelta.toFixed(3) });
        }
        break;

      case 'RAISING': {
        if (this.smoothedWristDelta > this.peakWristDelta) this.peakWristDelta = this.smoothedWristDelta;
        const delta = Math.abs(this.smoothedWristDelta - this.prevSmoothedWristDelta);
        if (this.smoothedWristDelta > AT_TOP_THRESHOLD) {
          if (delta < AT_TOP_STABILITY_DELTA) {
            this.stableTopCount++;
            if (this.stableTopCount >= AT_TOP_STABILITY_FRAMES) {
              this.repState = 'AT_TOP';
              debugLog('STAR_JUMP', 'STATE', 'RAISING → AT_TOP', { peak: +this.peakWristDelta.toFixed(3) });
            }
          } else {
            this.stableTopCount = 0;
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_TOP': {
        if (this.smoothedWristDelta > this.peakWristDelta) this.peakWristDelta = this.smoothedWristDelta;
        const dropFromPeak = this.peakWristDelta - this.smoothedWristDelta;
        const frameDelta = this.smoothedWristDelta - this.prevSmoothedWristDelta;
        if (frameDelta < -AT_TOP_STABILITY_DELTA || dropFromPeak >= LOWERING_DROP_FROM_PEAK) {
          this.repState = 'LOWERING';
          debugLog('STAR_JUMP', 'STATE', 'AT_TOP → LOWERING', { peak: +this.peakWristDelta.toFixed(3) });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedWristDelta < DOWN_RETURN_THRESHOLD) {
          this.completeRep(now);
          this.repState = 'DOWN';
          this.downSince = now;
          this.downDeltaMin = Infinity;
          this.downDeltaMax = -Infinity;
          this.downSettledSince = 0;
          this.downBaselineReseeded = false;
        }
        break;
    }
  }

  // Fix D: validate bilateral symmetry FIRST, then depth.
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    const peakSum = this.peakDeltaLeft + this.peakDeltaRight;
    if (peakSum > 0) {
      const lo = Math.min(this.peakDeltaLeft, this.peakDeltaRight);
      const hi = Math.max(this.peakDeltaLeft, this.peakDeltaRight);
      if (hi > 0 && lo / hi < MIN_BILATERAL_SYMMETRY) {
        return { ok: false, reason: 'unilateral' };
      }
    }
    if (this.peakWristDelta < MIN_REP_PEAK_DELTA) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repWristVelocities.length > 0) {
      const peakV = Math.max(...this.repWristVelocities.map(Math.abs));
      if (peakV > MAX_WRIST_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('STAR_JUMP', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDelta: +this.peakWristDelta.toFixed(3),
        leftPeak: +this.peakDeltaLeft.toFixed(3),
        rightPeak: +this.peakDeltaRight.toFixed(3),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-star-jump', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.peakWristDelta);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.peakWristDelta * 100 * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('STAR_JUMP', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private checkNoMovement(now: number): void {
    if (this.repState !== 'DOWN') {
      this.downSince = now;
      this.downDeltaMin = this.smoothedWristDelta;
      this.downDeltaMax = this.smoothedWristDelta;
      this.downSettledSince = 0;
      this.downBaselineReseeded = false;
      return;
    }
    if (this.smoothedWristDelta < this.downDeltaMin) this.downDeltaMin = this.smoothedWristDelta;
    if (this.smoothedWristDelta > this.downDeltaMax) this.downDeltaMax = this.smoothedWristDelta;

    // Fix O: post-rep EMA-decay reseed. After a rep, smoothedWristDelta decays
    // from near-zero back to ~-0.20 over several seconds, permanently inflating
    // max - min so 'not-moving' never fires after a rest. Re-baseline once
    // per-frame change has been < 0.005 for 500ms.
    if (!this.downBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedWristDelta - this.prevSmoothedWristDelta);
      if (emaDelta < 0.005) {
        if (this.downSettledSince === 0) this.downSettledSince = now;
        if (now - this.downSettledSince >= 500) {
          this.downDeltaMin = this.smoothedWristDelta;
          this.downDeltaMax = this.smoothedWristDelta;
          this.downSince = now;
          this.downBaselineReseeded = true;
        }
      } else {
        this.downSettledSince = 0;
      }
    }

    const idleMs = now - this.downSince;
    const variance = this.downDeltaMax - this.downDeltaMin;

    // Fix P: cold-start cooldown sentinel — lastNoMovementWarnAt=0 means "never
    // fired"; allow first fire immediately without waiting NO_MOVEMENT_REPEAT_MS.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS && variance < NO_MOVEMENT_VARIANCE && firstFireAllowed) {
      this.lastNoMovementWarnAt = now;
      debugLog('STAR_JUMP', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        deltaVariance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.downSince = now;
      this.downDeltaMin = this.smoothedWristDelta;
      this.downDeltaMax = this.smoothedWristDelta;
      this.downSettledSince = 0;
      this.downBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.peakWristDelta = -Infinity;
    this.peakDeltaLeft = -Infinity;
    this.peakDeltaRight = -Infinity;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, legSpreadOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.torsoSwingFrames = 0;
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER])  && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_WRIST])    && lmVisible(landmarks[LM.RIGHT_WRIST])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_ANKLE])    && lmVisible(landmarks[LM.RIGHT_ANKLE]);
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
    debugLog('STAR_JUMP', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('STAR_JUMP', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
