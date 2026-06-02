/**
 * InchwormEngine — rep-based tracker for side-camera inchworm exercise.
 *
 * Mirrors the pushup engine's state machine structure with the primary metric
 * replaced: elbow flexion → hip hinge angle (shoulder-hip-knee triangle).
 *
 * State machine:
 *   STANDING (hinge ≤ 12°) → FOLDING (hinge > 15°) → AT_BOTTOM (stable 8+
 *   frames at low Δ, hinge > 55°) → RISING (hinge dropping from peak by 10°+
 *   or 3°+ per frame) → STANDING (hinge < 12°, rep counted).
 *
 * Incorporates:
 *   Fix N — position-lost detection (lunge engine pattern)
 *   Fix O — EMA reseed after rep (lunge engine pattern)
 *   Fix P — cold-start cooldown for not-moving warning
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, hipHingeDeg } from './geometry';
import { InchwormCalibration } from './calibration';
import type {
  InchwormBaseline, InchwormEngineCallbacks, InchwormFrameMetrics, InchwormRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.15;
const STANDING_THRESHOLD_DEG = 12;
const DESCEND_START_DEG = 15;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3.0;
const ASCENDING_DELTA_MIN = 3.0;
const ASCENT_FROM_PEAK_DEG = 10;
// Minimum depth to count as a valid rep (shallow folds rejected with
// 'incomplete-inchworm' cue so the user gets actionable depth feedback)
const MIN_REP_DEPTH_DEG = 45;

// Wrong-movement sanity gates
const MIN_REP_DURATION_MS = 600;
// Fix R: track hip Y velocity (same landmark as squat hip velocity, same scale)
const MAX_HIP_VELOCITY = 1.5;
const MAX_REP_DURATION_MS = 12000;

// Idle detection
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

export class InchwormEngine {
  private callbacks: InchwormEngineCallbacks;
  private calibration: InchwormCalibration;
  private baseline: InchwormBaseline | null = null;

  private repState: InchwormRepState = 'STANDING';
  private smoothedHingeDeg = 0;
  private prevSmoothedHingeDeg = 0;
  private stableBottomCount = 0;
  private maxHingeThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection
  private standingSince = 0;
  private standingHingeMin = Infinity;
  private standingHingeMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: post-rep EMA-decay reseed
  // Without this, the smoothedHingeDeg decay tail after a rep permanently
  // inflates `max - min` so `not-moving` never fires after the user rests.
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position-lost detection (tracking-validity heartbeat)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: InchwormEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new InchwormCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix P: initialize standingSince + idle tracking on cal-confirm.
        // Without this the construction-time-0 value causes an instant false-
        // positive 'not-moving' on the first post-cal frame.
        this.standingSince = now;
        this.standingHingeMin = this.smoothedHingeDeg;
        this.standingHingeMax = this.smoothedHingeDeg;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat on cal-confirm.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('INCHWORM', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            bodyLengthY: +this.baseline.bodyLengthY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs regardless of whether the current frame
    // has usable landmarks (the whole point is to detect missing frames).
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedHingeDeg = 0;
    this.prevSmoothedHingeDeg = 0;
    this.stableBottomCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];

    // hasCoreLandmarks already checked these are visible — safe to use
    const rawHinge = hipHingeDeg(shoulder, hip, knee);

    // EMA smoothing
    this.smoothedHingeDeg = this.smoothedHingeDeg === 0
      ? rawHinge
      : EMA_ALPHA * rawHinge + (1 - EMA_ALPHA) * this.smoothedHingeDeg;

    // Hip Y velocity (drives smoothness score — hip is the primary moving landmark)
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (hip.y - this.prevHipY) / dt;
        if (this.repState === 'FOLDING' || this.repState === 'RISING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = hip.y;
    this.prevHipTimestamp = now;

    // Form accumulation during active rep phases (FOLDING / AT_BOTTOM / RISING)
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: InchwormFrameMetrics = {
      hipHingeDeg: rawHinge,
      smoothedHingeDeg: this.smoothedHingeDeg,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedHingeDeg = this.smoothedHingeDeg;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedHingeDeg > DESCEND_START_DEG) {
          this.repState = 'FOLDING';
          // Must reset FIRST, then set repStartedAt (Fix C from pushup: resetRepBuffers
          // zeros repStartedAt, so assign after the reset call).
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('INCHWORM', 'STATE', 'STANDING → FOLDING', { hinge: +this.smoothedHingeDeg.toFixed(1) });
        }
        break;

      case 'FOLDING': {
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHingeDeg);
        const delta = Math.abs(this.smoothedHingeDeg - this.prevSmoothedHingeDeg);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('INCHWORM', 'STATE', 'FOLDING → AT_BOTTOM', { peak: +this.maxHingeThisRep.toFixed(1) });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHingeDeg);
        const deltaDown = this.smoothedHingeDeg - this.prevSmoothedHingeDeg;
        const dropFromPeak = this.maxHingeThisRep - this.smoothedHingeDeg;
        if (deltaDown < -ASCENDING_DELTA_MIN || dropFromPeak >= ASCENT_FROM_PEAK_DEG) {
          this.repState = 'RISING';
          debugLog('INCHWORM', 'STATE', 'AT_BOTTOM → RISING', { peak: +this.maxHingeThisRep.toFixed(1) });
        }
        break;
      }

      case 'RISING':
        if (this.smoothedHingeDeg < STANDING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHingeMin = Infinity;
          this.standingHingeMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.maxHingeThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt > MAX_REP_DURATION_MS) {
      return { ok: false, reason: 'too-slow' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('INCHWORM', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDepth: +this.maxHingeThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-inchworm', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxHingeThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxHingeThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('INCHWORM', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // Fix O: EMA reseed pattern (mirrors lunge engine checkNoMovement)
  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingHingeMin = this.smoothedHingeDeg;
      this.standingHingeMax = this.smoothedHingeDeg;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedHingeDeg < this.standingHingeMin) this.standingHingeMin = this.smoothedHingeDeg;
    if (this.smoothedHingeDeg > this.standingHingeMax) this.standingHingeMax = this.smoothedHingeDeg;

    // Fix O: re-baseline once the EMA has settled so the post-rep decay tail
    // (smoothedHingeDeg drifting from ~15° → 0°) doesn't permanently inflate
    // `max - min`. Once per-frame change has been under 0.3° for 500 ms, drop
    // the cached min/max and reseed from the current value.
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedHingeDeg - this.prevSmoothedHingeDeg);
      if (emaDelta < 0.3) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingHingeMin = this.smoothedHingeDeg;
          this.standingHingeMax = this.smoothedHingeDeg;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    const idleMs = now - this.standingSince;
    const variance = this.standingHingeMax - this.standingHingeMin;
    // Fix P: cold-start cooldown. lastNoMovementWarnAt = 0 initially.
    // If `now` < NO_MOVEMENT_REPEAT_MS at first potential fire, the cooldown
    // would block it. Treat 0 sentinel as "never fired" and allow the first fire.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('INCHWORM', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        hingeVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingHingeMin = this.smoothedHingeDeg;
      this.standingHingeMax = this.smoothedHingeDeg;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxHingeThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  /** Mirrors the coreOk check inside processTrackingFrame so the position-lost
   *  detection uses the same definition of "usable frame". */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    if (!this.baseline) return false;
    const side = this.baseline.side;
    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    return lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
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
    debugLog('INCHWORM', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('INCHWORM', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
