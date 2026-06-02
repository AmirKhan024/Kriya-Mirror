/**
 * ConventionalDeadliftEngine — rep-based tracker for side-camera Conventional Deadlift.
 *
 * State machine (based on hip hinge angle measured at hip in shoulder-hip-knee triangle):
 *   STANDING (hinge ≤ 15°) → HINGING (hinge > 25°) →
 *   AT_BOTTOM (stable 8+ frames, Δ < 3°) → EXTENDING (hinge dropping) → STANDING (hinge < 15°, rep done)
 *
 * Uses the camera-side landmarks (the side with higher landmark visibility).
 *
 * Warnings (all Apply Fixes A–R from bilal_prompt.md):
 *   - `rounded-back`      — shoulder droops below hip during hinge (back losing neutral)
 *   - `hips-shooting-up`  — during EXTENDING, hip rises faster than shoulder (good-morning fault)
 *   - `incomplete-deadlift` — peak hinge < MIN_REP_DEPTH (didn't hinge deep enough)
 *   - `malformed-rep`     — too fast (ballistic) or too short duration
 *   - `not-moving`        — 5 s idle post-calibration
 *   - `position-lost`     — no usable landmarks for ≥ 3 s post-calibration
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, hipHingeDeg } from './geometry';
import { DeadliftCalibration } from './calibration';
import type { DeadliftBaseline, DeadliftEngineCallbacks, DeadliftFrameMetrics, DeadliftRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.15;

// State machine thresholds
const STANDING_THRESHOLD_DEG = 15;
const HINGE_START_DEG = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;

// Rep validation (Fix B, C, D)
// Min depth: 45° smoothed peak. At EMA(α=0.15) the smoothed peak is ~55% of raw
// at short cycles — 45° allows ballistic gate to trip for feedback. See B10 in known-issues.
const MIN_REP_DEPTH_DEG = 45;
const MIN_REP_DURATION_MS = 400;
// Hip velocity threshold — side camera hip movement per second. Reference: squat/lunge = 1.5.
// Deadlift hips travel a large vertical arc, use 1.8 as starting point (tune at physical test).
const MAX_HIP_VELOCITY = 1.8;

// Warning thresholds
// Rounded back: shoulder.y > hip.y + this threshold → shoulder drooped below hip (screen y = down)
const ROUNDED_BACK_SHOULDER_DROP = 0.04;
// Hips shooting up: during EXTENDING, hip y-change (rise) must be < this multiple of shoulder y-change
const HIPS_SHOOTING_RATIO = 2.5;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_FORM_OK_FRAMES = 6;

// Fix I + Fix P: idle warning after 5 s, repeat max every 15 s
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class ConventionalDeadliftEngine {
  private callbacks: DeadliftEngineCallbacks;
  private calibration: DeadliftCalibration;
  private baseline: DeadliftBaseline | null = null;

  private repState: DeadliftRepState = 'STANDING';
  private smoothedHinge = 0;
  private prevSmoothedHinge = 0;
  private stableBottomCount = 0;
  private maxHingeThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { backStraightCount: 0, hipLevelCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Hip/shoulder velocity tracking for hips-shooting-up
  private prevHipY = 0;
  private prevShoulderY = 0;
  private prevTimestamp = 0;

  private repStartedAt = 0;

  // Rounded back debounce
  private roundedBackFrames = 0;

  // Hips shooting up detection state (per rep)
  private hipsShootingUpFrames = 0;

  // Idle detection (Fix I + Fix O + Fix P)
  private standingSince = 0;
  private standingHingeMin = Infinity;
  private standingHingeMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: DeadliftEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new DeadliftCalibration();
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
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('DEADLIFT', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            hipY: +this.baseline.hipY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: check position-lost before the null early-return
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
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(knee) || !lmVisible(ankle)) return;

    const rawHinge = hipHingeDeg(shoulder, hip, knee);
    // Fix B10: EMA init with === 0 branch so first frame sets value directly.
    // This is load-bearing for ballistic-rep detection (see known-issues B10).
    this.smoothedHinge = this.smoothedHinge === 0
      ? rawHinge
      : EMA_ALPHA * rawHinge + (1 - EMA_ALPHA) * this.smoothedHinge;

    // Save previous values BEFORE updating so delta checks below use the old → new diff.
    const prevHipY = this.prevHipY;
    const prevShoulderY = this.prevShoulderY;
    const prevTs = this.prevTimestamp;

    // Hip/shoulder Y velocity tracking
    if (prevTs > 0) {
      const dt = (now - prevTs) / 1000;
      if (dt > 0) {
        const hipV = (hip.y - prevHipY) / dt;
        if (this.repState === 'HINGING' || this.repState === 'EXTENDING') {
          this.repHipVelocities.push(hipV);
        }
      }
    }
    this.prevHipY = hip.y;
    this.prevShoulderY = shoulder.y;
    this.prevTimestamp = now;

    // --- Posture checks ---
    // Rounded back: shoulder droops below hip level (shoulder.y > hip.y in screen coords)
    // Only meaningful during active rep (hinge in progress)
    const shoulderBelowHip = (shoulder.y - hip.y) > ROUNDED_BACK_SHOULDER_DROP;
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep && shoulderBelowHip) {
      this.roundedBackFrames++;
    } else {
      this.roundedBackFrames = 0;
    }
    const roundedBackWarn = this.roundedBackFrames >= NO_FORM_OK_FRAMES;

    // Hips shooting up: only relevant during EXTENDING phase
    // Detect: hip rises faster than shoulder (hip.y drops faster than shoulder.y)
    // In screen coords: "rising" = y decreasing. Hip shooting up = hipDeltaY more negative than shoulder.
    let hipsShootingUp = false;
    if (this.repState === 'EXTENDING' && prevTs > 0) {
      const dt = (now - prevTs) / 1000;
      if (dt > 0.001) {
        const hipDeltaY = hip.y - prevHipY;         // negative = hip rising
        const shoulderDeltaY = shoulder.y - prevShoulderY; // negative = shoulder rising
        if (hipDeltaY < -0.001 && (shoulderDeltaY > hipDeltaY * HIPS_SHOOTING_RATIO || shoulderDeltaY >= 0)) {
          this.hipsShootingUpFrames++;
        } else {
          this.hipsShootingUpFrames = 0;
        }
        hipsShootingUp = this.hipsShootingUpFrames >= NO_FORM_OK_FRAMES;
      }
    } else {
      this.hipsShootingUpFrames = 0;
    }

    // Form accumulation (only during active rep)
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!roundedBackWarn) this.repFormCounts.backStraightCount++;
      this.repFormCounts.hipLevelCount++;  // hip-level always OK (no bilateral check for deadlift)
    }

    if (roundedBackWarn) this.repWarnings.add('rounded-back');
    if (hipsShootingUp) this.repWarnings.add('hips-shooting-up');

    // Fix A: gate form coaching to active rep phase (not while standing between reps)
    if (inActiveRep) {
      this.maybeEmitWarning('rounded-back', roundedBackWarn, now);
      this.maybeEmitWarning('hips-shooting-up', hipsShootingUp, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const metrics: DeadliftFrameMetrics = {
      hipHingeDeg: rawHinge,
      smoothedHingeDeg: this.smoothedHinge,
      repState: this.repState,
      roundedBack: roundedBackWarn,
      hipsShootingUp,
    };
    this.callbacks.onFrame?.(metrics);

    this.prevSmoothedHinge = this.smoothedHinge;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedHinge > HINGE_START_DEG) {
          this.repState = 'HINGING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('DEADLIFT', 'STATE', 'STANDING → HINGING', {
            hinge: +this.smoothedHinge.toFixed(1),
          });
        }
        break;

      case 'HINGING': {
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHinge);
        const delta = Math.abs(this.smoothedHinge - this.prevSmoothedHinge);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('DEADLIFT', 'STATE', 'HINGING → AT_BOTTOM', {
              peak: +this.maxHingeThisRep.toFixed(1),
            });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.maxHingeThisRep = Math.max(this.maxHingeThisRep, this.smoothedHinge);
        const deltaDown = this.smoothedHinge - this.prevSmoothedHinge;
        const dropFromPeak = this.maxHingeThisRep - this.smoothedHinge;
        if (deltaDown < -ASCENDING_DELTA_MIN || dropFromPeak >= ASCENT_FROM_PEAK_DEG) {
          this.repState = 'EXTENDING';
          this.hipsShootingUpFrames = 0;
          debugLog('DEADLIFT', 'STATE', 'AT_BOTTOM → EXTENDING', {
            peak: +this.maxHingeThisRep.toFixed(1),
          });
        }
        break;
      }

      case 'EXTENDING':
        if (this.smoothedHinge < STANDING_THRESHOLD_DEG) {
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

  // ----------------------------------------------------------
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: too-shallow check first (no unilateral check for deadlift)
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
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('DEADLIFT', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakHinge: +this.maxHingeThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-deadlift', true, now);
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
    debugLog('DEADLIFT', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  // Fix I + Fix O + Fix P: idle detection with EMA-decay reseed
  // ----------------------------------------------------------
  private checkNoMovement(now: number): void {
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
      debugLog('DEADLIFT', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingHingeMin = this.smoothedHinge;
      this.standingHingeMax = this.smoothedHinge;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxHingeThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { backStraightCount: 0, hipLevelCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.roundedBackFrames = 0;
    this.hipsShootingUpFrames = 0;
  }

  // ----------------------------------------------------------
  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('DEADLIFT', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    if (!this.baseline) {
      // Before calibration, check both sides
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
    debugLog('DEADLIFT', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
