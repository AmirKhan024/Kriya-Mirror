/**
 * BarbellRowEngine — rep-based tracker for side-camera Barbell / Dumbbell Row.
 *
 * The user calibrates in the bent-over position (~45° hip hinge). This working
 * position is CONSTANT throughout the session — the state machine only tracks
 * elbow flexion (arm rowing motion):
 *
 *   HANGING (elbow flex ≤ 20°, arms hanging straight)
 *     → ROWING (elbow flex > 30°, driving up)
 *     → AT_ROW_TOP (stable 6+ frames at peak)
 *     → LOWERING (elbow flex decreasing)
 *     → HANGING (elbow flex ≤ 20°, rep complete)
 *
 * Note: elbowFlexionDeg here measures deviation from STRAIGHT, so:
 *   - Arms hanging (nearly straight): small value (~5–20°)
 *   - Elbows at row top: larger value (~80–130°)
 *
 * Warnings:
 *   - `rounded-back`    — shoulder drops below hip during row (back losing neutral)
 *   - `row-momentum`    — hip Y oscillation during ROWING/AT_ROW_TOP (body-english)
 *   - `incomplete-row`  — peak elbow flex < MIN_REP_DEPTH (didn't pull high enough)
 *   - `malformed-rep`   — too fast or too short
 *   - `not-moving`      — 5s idle post-calibration
 *   - `position-lost`   — no usable landmarks ≥ 3s post-calibration
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, elbowFlexionDeg } from './geometry';
import { RowCalibration } from './calibration';
import type { RowBaseline, RowEngineCallbacks, RowFrameMetrics, RowRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ELBOW = 0.15;

// State machine thresholds
// Arms hanging: elbow flexion <= this threshold (arms nearly straight)
const HANGING_THRESHOLD_DEG = 20;
// Rowing starts: elbow flexion > this (arm starting to drive up)
const ROW_START_DEG = 30;
// Top stability
const ROW_TOP_STABILITY_FRAMES = 6;
const ROW_TOP_STABILITY_DELTA = 3;
// Lowering detection
const LOWERING_DELTA_MIN = 3;
const DESCENT_FROM_PEAK_DEG = 10;

// Rep validation (Fix B)
// Min rep depth: elbow must reach at least 80° flex to count as a full row
const MIN_REP_DEPTH_DEG = 80;
const MIN_REP_DURATION_MS = 500;
// Wrist Y velocity threshold — distal end, so slightly higher threshold than hip
const MAX_WRIST_VELOCITY = 3.5;

// Warning thresholds
// Rounded back: shoulder.y > hip.y + this threshold → shoulder dropped below hip
const ROUNDED_BACK_SHOULDER_DROP = 0.04;
// Row momentum: hip Y variance during active row
const ROW_MOMENTUM_HIP_VARIANCE = 0.04;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_FORM_OK_FRAMES = 6;

// Fix I + Fix P: idle warning after 5s, repeat max every 15s
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class BarbellRowEngine {
  private callbacks: RowEngineCallbacks;
  private calibration: RowCalibration;
  private baseline: RowBaseline | null = null;

  private repState: RowRepState = 'HANGING';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableTopCount = 0;
  private maxFlexionThisRep = 0;
  private repWristVelocities: number[] = [];
  private repFormCounts = { backStraightCount: 0, hipLevelCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Wrist velocity tracking
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  // Per-rep timing
  private repStartedAt = 0;

  // Hip Y tracking for momentum detection
  private prevHipY = 0;
  private hipYMin = Infinity;
  private hipYMax = -Infinity;

  // Posture debounce counters
  private roundedBackFrames = 0;
  private rowMomentumFrames = 0;

  // Fix I + Fix O + Fix P: idle detection
  private hangingSince = 0;
  private hangingFlexMin = Infinity;
  private hangingFlexMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private hangingSettledSince = 0;
  private hangingBaselineReseeded = false;

  // Fix N: position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: RowEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new RowCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I + Fix P: seed idle tracking on cal-confirm
        this.hangingSince = now;
        this.hangingFlexMin = this.smoothedFlexion;
        this.hangingFlexMax = this.smoothedFlexion;
        this.hangingSettledSince = 0;
        this.hangingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('ROW', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            hipHingeDegAtCal: +this.baseline.hipHingeDegAtCal.toFixed(1),
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
    this.repState = 'HANGING';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const elbow = landmarks[side === 'left' ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW];
    const wrist = landmarks[side === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(knee) || !lmVisible(elbow) || !lmVisible(wrist)) return;

    const rawFlexion = elbowFlexionDeg(shoulder, elbow, wrist);
    // Fix B10: EMA init with === 0 branch so first frame sets value directly.
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_ELBOW * rawFlexion + (1 - EMA_ALPHA_ELBOW) * this.smoothedFlexion;

    // Wrist Y velocity for smoothness tracking
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wrist.y - this.prevWristY) / dt;
        if (this.repState === 'ROWING' || this.repState === 'LOWERING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wrist.y;
    this.prevWristTimestamp = now;

    // Hip Y tracking for momentum detection
    if (this.prevHipY !== 0) {
      if (hip.y < this.hipYMin) this.hipYMin = hip.y;
      if (hip.y > this.hipYMax) this.hipYMax = hip.y;
    } else {
      this.hipYMin = hip.y;
      this.hipYMax = hip.y;
    }
    this.prevHipY = hip.y;

    // --- Posture checks ---
    // Rounded back: shoulder drops below hip level (shoulder.y > hip.y in screen coords)
    // Fix A: only during active rep (not during HANGING)
    const shoulderBelowHip = (shoulder.y - hip.y) > ROUNDED_BACK_SHOULDER_DROP;
    const inActiveRep = this.repState !== 'HANGING';

    if (inActiveRep && shoulderBelowHip) {
      this.roundedBackFrames++;
    } else {
      this.roundedBackFrames = 0;
    }
    const roundedBackWarn = this.roundedBackFrames >= NO_FORM_OK_FRAMES;

    // Row momentum: hip Y oscillation during active row
    // Only meaningful if we have enough hip tracking data
    let rowMomentumWarn = false;
    if (inActiveRep) {
      const hipVariance = this.hipYMax - this.hipYMin;
      const hipOscillating = hipVariance > ROW_MOMENTUM_HIP_VARIANCE;
      if (hipOscillating) {
        this.rowMomentumFrames++;
      } else {
        this.rowMomentumFrames = 0;
      }
      rowMomentumWarn = this.rowMomentumFrames >= NO_FORM_OK_FRAMES;
    } else {
      this.rowMomentumFrames = 0;
    }

    // Form accumulation (only during active rep)
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!roundedBackWarn) this.repFormCounts.backStraightCount++;
      if (!rowMomentumWarn) this.repFormCounts.hipLevelCount++;
    }

    if (roundedBackWarn) this.repWarnings.add('rounded-back');
    if (rowMomentumWarn) this.repWarnings.add('row-momentum');

    // Fix A: gate form coaching to active rep phase
    if (inActiveRep) {
      this.maybeEmitWarning('rounded-back', roundedBackWarn, now);
      this.maybeEmitWarning('row-momentum', rowMomentumWarn, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const metrics: RowFrameMetrics = {
      elbowFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      roundedBack: roundedBackWarn,
      hipSway: rowMomentumWarn,
    };
    this.callbacks.onFrame?.(metrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'HANGING':
        if (this.smoothedFlexion > ROW_START_DEG) {
          this.repState = 'ROWING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          // Reset hip variance tracking at rep start
          this.hipYMin = this.prevHipY;
          this.hipYMax = this.prevHipY;
          debugLog('ROW', 'STATE', 'HANGING → ROWING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'ROWING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < ROW_TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= ROW_TOP_STABILITY_FRAMES) {
            this.repState = 'AT_ROW_TOP';
            debugLog('ROW', 'STATE', 'ROWING → AT_ROW_TOP', {
              peak: +this.maxFlexionThisRep.toFixed(1),
            });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_ROW_TOP': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -LOWERING_DELTA_MIN || dropFromPeak >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('ROW', 'STATE', 'AT_ROW_TOP → LOWERING', {
            peak: +this.maxFlexionThisRep.toFixed(1),
          });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedFlexion <= HANGING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'HANGING';
          this.hangingSince = now;
          this.hangingFlexMin = Infinity;
          this.hangingFlexMax = -Infinity;
          this.hangingSettledSince = 0;
          this.hangingBaselineReseeded = false;
        }
        break;
    }
  }

  // ----------------------------------------------------------
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix B: too-shallow check
    if (this.maxFlexionThisRep < MIN_REP_DEPTH_DEG) {
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
      debugLog('ROW', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakFlex: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-row', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxFlexionThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload: {
      depthDeg: number;
      smoothness: number;
      form: number;
      mqs: number;
      warnings: WarningType[];
    } = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('ROW', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  // Fix I + Fix O + Fix P: idle detection with EMA-decay reseed
  // ----------------------------------------------------------
  private checkNoMovement(now: number): void {
    if (this.repState !== 'HANGING') {
      this.hangingSince = now;
      this.hangingFlexMin = this.smoothedFlexion;
      this.hangingFlexMax = this.smoothedFlexion;
      this.hangingSettledSince = 0;
      this.hangingBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.hangingFlexMin) this.hangingFlexMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.hangingFlexMax) this.hangingFlexMax = this.smoothedFlexion;

    // Fix O: re-baseline once EMA has settled post-rep
    if (!this.hangingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.hangingSettledSince === 0) this.hangingSettledSince = now;
        if (now - this.hangingSettledSince >= 500) {
          this.hangingFlexMin = this.smoothedFlexion;
          this.hangingFlexMax = this.smoothedFlexion;
          this.hangingSince = now;
          this.hangingBaselineReseeded = true;
        }
      } else {
        this.hangingSettledSince = 0;
      }
    }

    const idleMs = now - this.hangingSince;
    const variance = this.hangingFlexMax - this.hangingFlexMin;
    // Fix P: cold-start cooldown — treat lastNoMovementWarnAt === 0 as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('ROW', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.hangingSince = now;
      this.hangingFlexMin = this.smoothedFlexion;
      this.hangingFlexMax = this.smoothedFlexion;
      this.hangingSettledSince = 0;
      this.hangingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { backStraightCount: 0, hipLevelCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.roundedBackFrames = 0;
    this.rowMomentumFrames = 0;
  }

  // ----------------------------------------------------------
  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('ROW', 'WARN', type);
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
    const elbow = landmarks[side === 'left' ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW];
    const wrist = landmarks[side === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST];
    return lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(elbow) && lmVisible(wrist);
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
    debugLog('ROW', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
