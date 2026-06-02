/**
 * KettlebellSwingEngine — rep-based tracker for side-camera Kettlebell Swing.
 *
 * State machine (based on hip hinge angle measured at hip in shoulder-hip-knee triangle):
 *   STANDING (hinge ≤ 15°) → HIKE_BACK (hinge > 25°) →
 *   AT_BOTTOM (hinge ≥ 50° stable 2+ frames OR hinge starts decreasing) →
 *   SNAPPING (hinge rapidly decreasing) → STANDING (hinge < 15° → REP COMPLETE)
 *
 * Uses the camera-side landmarks (the side with higher landmark visibility).
 *
 * Warnings (all Fixes A–R applied):
 *   - `squat-pattern`         — knee bends > 25° more than calibration baseline
 *   - `arm-lift`              — wrist rises above shoulder at the top (active arm drive)
 *   - `incomplete-extension`  — rep completes but hip angle at top > 15° (incomplete extension)
 *   - `malformed-rep`         — too fast (ballistic) or too short duration
 *   - `not-moving`            — 5s idle post-calibration
 *   - `position-lost`         — no usable landmarks for ≥ 3s post-calibration
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, hipHingeDeg, kneeFlexionDeg, armLiftDetected, torsoAngleDeg } from './geometry';
import { KBSwingCalibration } from './calibration';
import type { KBSwingBaseline, KBSwingEngineCallbacks, KBSwingFrameMetrics, KBSwingRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// EMA slightly higher than deadlift — swing is faster/more explosive
const EMA_ALPHA_HINGE = 0.18;

// State machine thresholds
const STANDING_THRESHOLD_DEG = 15;   // Fix O idle state
const HINGE_ENTER_DEG = 25;          // STANDING → HIKE_BACK
const HINGE_EXIT_DEG = 15;           // SNAPPING → STANDING (hysteresis)
const HINGE_PEAK_DEG = 50;           // Must reach this to count as AT_BOTTOM

// Rep validation (Fix B, C, D)
const MIN_REP_DEPTH_DEG = 50;        // incomplete-extension if peak hinge < this
const MIN_REP_DURATION_MS = 400;     // too fast = malformed-rep
// Fix R: ballistic threshold — swing is explosive but hip landmark arc is similar to fast deadlift
const MAX_HIP_VELOCITY = 2.0;

// Warning thresholds
const SQUAT_PATTERN_KNEE_THRESHOLD = 25;  // degrees of extra knee bend above calibration baseline
const ARM_LIFT_WRIST_THRESHOLD = 0.04;    // wrist.y above shoulder.y (normalised frame)
// Rounded-back: torso inclination (from torsoAngleDeg) at or above this means the shoulder
// has dropped to near-horizontal, indicating the back is rounding rather than the hip hinging cleanly.
// torsoAngleDeg returns 90° when shoulder.y == hip.y (horizontal), > 90° when shoulder is below hip.
// Threshold of 88° catches gross back-rounding while ignoring normal deep hinge (~65-75°).
const ROUNDED_BACK_TORSO_THRESHOLD = 88;
const ROUNDED_BACK_DEBOUNCE_FRAMES = 6;
// SNAPPING timeout: if the user stops short of full extension for this long, fire incomplete-extension
const SNAPPING_TIMEOUT_MS = 4000;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_FORM_OK_FRAMES = 6;

// Fix I + Fix P: idle warning after 5s, repeat max every 15s
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class KettlebellSwingEngine {
  private callbacks: KBSwingEngineCallbacks;
  private calibration: KBSwingCalibration;
  private baseline: KBSwingBaseline | null = null;

  private repState: KBSwingRepState = 'STANDING';
  private smoothedHinge = 0;
  private prevSmoothedHinge = 0;
  private maxHingeThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { backStraightCount: 0, hipLevelCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Hip Y velocity tracking
  private prevHipY = 0;
  private prevTimestamp = 0;

  private repStartedAt = 0;

  // Squat-pattern debounce frames
  private squatPatternFrames = 0;

  // Rounded-back debounce (P1-2)
  private roundedBackFrames = 0;

  // Top-extension tracking (P1-1): minimum hinge reached during SNAPPING + when SNAPPING entered
  private snappingEnteredAt = 0;

  // Idle detection (Fix I + Fix O + Fix P)
  private standingSince = 0;
  private standingHingeMin = Infinity;
  private standingHingeMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: post-rep EMA-decay reseed
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: KBSwingEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new KBSwingCalibration();
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
        this.standingHingeMin = this.smoothedHinge;
        this.standingHingeMax = this.smoothedHinge;
        // Fix O: initialise reseed fields
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('KBSWING', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            hipY: +this.baseline.hipY.toFixed(3),
            kneeAngleAtCalibration: +this.baseline.kneeAngleAtCalibration.toFixed(1),
          });
        }
      }
      return;
    }

    // Fix N: check position-lost BEFORE the null early-return (top of update)
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedHinge = 0;
    this.prevSmoothedHinge = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    const wrist = landmarks[side === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(knee) || !lmVisible(ankle)) return;

    const rawHinge = hipHingeDeg(shoulder, hip, knee);
    // Fix R (B10): EMA init with === 0 branch so first frame sets value directly
    this.smoothedHinge = this.smoothedHinge === 0
      ? rawHinge
      : EMA_ALPHA_HINGE * rawHinge + (1 - EMA_ALPHA_HINGE) * this.smoothedHinge;

    // Hip Y velocity tracking (for ballistic detection)
    const prevHipY = this.prevHipY;
    const prevTs = this.prevTimestamp;

    if (prevTs > 0) {
      const dt = (now - prevTs) / 1000;
      if (dt > 0) {
        const hipV = (hip.y - prevHipY) / dt;
        if (this.repState === 'HIKE_BACK' || this.repState === 'SNAPPING') {
          this.repHipVelocities.push(hipV);
        }
      }
    }
    this.prevHipY = hip.y;
    this.prevTimestamp = now;

    // --- Posture checks ---
    const inActiveRep = this.repState !== 'STANDING';

    // Squat-pattern: knee bends more than calibration baseline + threshold
    const currentKneeAngle = kneeFlexionDeg(hip, knee, ankle);
    const kneeExcess = currentKneeAngle - baseline.kneeAngleAtCalibration;
    const isSquatPattern = kneeExcess > SQUAT_PATTERN_KNEE_THRESHOLD;

    if (inActiveRep && isSquatPattern) {
      this.squatPatternFrames++;
    } else {
      this.squatPatternFrames = 0;
    }
    const squatPatternWarn = this.squatPatternFrames >= NO_FORM_OK_FRAMES;

    // Rounded-back: uses torsoAngleDeg (shoulder-hip vector from vertical).
    // When torso exceeds ROUNDED_BACK_TORSO_THRESHOLD (88°), the torso is nearly horizontal —
    // the shoulder has drooped to near or below hip level, indicating gross back-rounding.
    const torsoAngle = torsoAngleDeg(shoulder, hip);
    if (inActiveRep && torsoAngle >= ROUNDED_BACK_TORSO_THRESHOLD) {
      this.roundedBackFrames++;
    } else {
      this.roundedBackFrames = 0;
    }
    const roundedBackWarn = this.roundedBackFrames >= ROUNDED_BACK_DEBOUNCE_FRAMES;

    // Arm-lift: wrist above shoulder at the top (during SNAPPING phase or returning to STANDING)
    let armLiftWarn = false;
    if (lmVisible(wrist)) {
      armLiftWarn = armLiftDetected(wrist.y, shoulder.y, ARM_LIFT_WRIST_THRESHOLD);
    }

    // Form accumulation (only during active rep)
    // backStraightCount: real torso check (no rounded back)
    // hipLevelCount: hip-pattern check (no squat pattern)
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!roundedBackWarn) this.repFormCounts.backStraightCount++;
      if (!squatPatternWarn) this.repFormCounts.hipLevelCount++;
    }

    if (squatPatternWarn) this.repWarnings.add('squat-pattern');
    if (roundedBackWarn) this.repWarnings.add('rounded-back');
    if (armLiftWarn && inActiveRep) this.repWarnings.add('arm-lift');

    // Fix A: gate form coaching to active rep phase (not while standing between reps)
    if (inActiveRep) {
      this.maybeEmitWarning('squat-pattern', squatPatternWarn, now);
      this.maybeEmitWarning('rounded-back', roundedBackWarn, now);
      this.maybeEmitWarning('arm-lift', armLiftWarn, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const metrics: KBSwingFrameMetrics = {
      hipHingeDeg: rawHinge,
      smoothedHingeDeg: this.smoothedHinge,
      repState: this.repState,
      squatPattern: squatPatternWarn,
      armLift: armLiftWarn,
    };
    this.callbacks.onFrame?.(metrics);

    this.prevSmoothedHinge = this.smoothedHinge;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedHinge > HINGE_ENTER_DEG) {
          this.repState = 'HIKE_BACK';
          // Fix C: resetRepBuffers FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('KBSWING', 'STATE', 'STANDING → HIKE_BACK', {
            hinge: +this.smoothedHinge.toFixed(1),
          });
        }
        break;

      case 'HIKE_BACK': {
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHinge);
        // Reached peak threshold → go to AT_BOTTOM
        const reachedPeak = this.smoothedHinge >= HINGE_PEAK_DEG;
        const startedDecreasing = this.smoothedHinge < this.prevSmoothedHinge - 1.5;
        if (reachedPeak) {
          this.repState = 'AT_BOTTOM';
          debugLog('KBSWING', 'STATE', 'HIKE_BACK → AT_BOTTOM', {
            peak: +this.maxHingeThisRep.toFixed(1),
          });
        } else if (startedDecreasing && this.maxHingeThisRep >= HINGE_PEAK_DEG) {
          // Peak was reached but we already started declining
          this.repState = 'SNAPPING';
          this.snappingEnteredAt = now;
          debugLog('KBSWING', 'STATE', 'HIKE_BACK → SNAPPING (peak hit, declining)', {
            peak: +this.maxHingeThisRep.toFixed(1),
          });
        } else if (startedDecreasing && this.maxHingeThisRep < HINGE_PEAK_DEG) {
          // Shallow rep: peak never reached threshold → skip to SNAPPING for completion check
          this.repState = 'SNAPPING';
          this.snappingEnteredAt = now;
          debugLog('KBSWING', 'STATE', 'HIKE_BACK → SNAPPING (shallow peak, declining)', {
            peak: +this.maxHingeThisRep.toFixed(1),
          });
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHinge);
        const dropFromPeak = this.maxHingeThisRep - this.smoothedHinge;
        // Transition to SNAPPING when hinge starts dropping appreciably from peak
        if (dropFromPeak >= 5 || this.smoothedHinge < this.prevSmoothedHinge - 1.5) {
          this.repState = 'SNAPPING';
          this.snappingEnteredAt = now;
          debugLog('KBSWING', 'STATE', 'AT_BOTTOM → SNAPPING', {
            peak: +this.maxHingeThisRep.toFixed(1),
          });
        }
        break;
      }

      case 'SNAPPING':
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHinge);
        if (this.smoothedHinge < HINGE_EXIT_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHingeMin = Infinity;
          this.standingHingeMax = -Infinity;
          // Fix O: reset reseed flags on rep transition
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
          debugLog('KBSWING', 'STATE', 'SNAPPING → STANDING (rep done)', {
            hinge: +this.smoothedHinge.toFixed(1),
          });
        } else if (this.snappingEnteredAt > 0 && now - this.snappingEnteredAt > SNAPPING_TIMEOUT_MS) {
          // User stopped short of full hip extension (P1-1): abandon rep, fire incomplete-extension
          debugLog('KBSWING', 'WARN', 'SNAPPING timeout — incomplete-extension', {
            hinge: +this.smoothedHinge.toFixed(1),
            elapsedMs: Math.round(now - this.snappingEnteredAt),
          });
          this.maybeEmitWarning('incomplete-extension', true, now);
          this.resetRepBuffers();
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

  // ----------------------------------------------------------
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 1. Shape/depth first (P2-1): shallow hinge → reject before timing checks.
    //    Note: `incomplete-extension` (top-of-swing failure) is handled via SNAPPING timeout,
    //    not here. A shallow bottom is a different fault → malformed-rep (generic).
    if (this.maxHingeThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    // 2. Duration gate
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    // 3. Ballistic jitter spike last
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('KBSWING', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakHinge: +this.maxHingeThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      // All rejection reasons here use malformed-rep.
      // incomplete-extension (top-of-swing failure) fires via SNAPPING timeout instead.
      this.maybeEmitWarning('malformed-rep', true, now);
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxHingeThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload: {
      depthDeg: number;
      smoothness: number;
      form: number;
      mqs: number;
      warnings: WarningType[];
    } = {
      depthDeg: Math.round(this.maxHingeThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('KBSWING', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  // Fix I + Fix O + Fix P: idle detection with EMA-decay reseed
  // ----------------------------------------------------------
  private checkNoMovement(now: number): void {
    // Fix O: reset idle buffers when not standing (in active rep)
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingHingeMin = this.smoothedHinge;
      this.standingHingeMax = this.smoothedHinge;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedHinge < this.standingHingeMin) this.standingHingeMin = this.smoothedHinge;
    if (this.smoothedHinge > this.standingHingeMax) this.standingHingeMax = this.smoothedHinge;

    // Fix O: re-baseline once EMA has settled post-rep (prevents decay tail from blocking not-moving)
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedHinge - this.prevSmoothedHinge);
      if (emaDelta < 0.3) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingHingeMin = this.smoothedHinge;
          this.standingHingeMax = this.smoothedHinge;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    const idleMs = now - this.standingSince;
    const variance = this.standingHingeMax - this.standingHingeMin;
    // Fix P: cold-start cooldown — treat lastNoMovementWarnAt === 0 as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('KBSWING', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      // Reset so next window starts fresh
      this.standingSince = now;
      this.standingHingeMin = this.smoothedHinge;
      this.standingHingeMax = this.smoothedHinge;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxHingeThisRep = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { backStraightCount: 0, hipLevelCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.squatPatternFrames = 0;
    this.roundedBackFrames = 0;
    this.snappingEnteredAt = 0;
  }

  // ----------------------------------------------------------
  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('KBSWING', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    if (!this.baseline) {
      return lmVisible(landmarks[LM.LEFT_SHOULDER]) || lmVisible(landmarks[LM.RIGHT_SHOULDER]);
    }
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
    debugLog('KBSWING', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
