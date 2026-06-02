/**
 * FireHydrantEngine — rep-based tracker for side-camera fire hydrant exercise.
 *
 * The person kneels on all fours (quadruped position). Each rep: they lift one
 * knee outward to the side (hip abduction), keeping the knee bent at ~90°,
 * until the thigh is roughly parallel to the floor (or as high as comfortable).
 * The engine tracks thigh lift via the hip→knee vector angle from vertical.
 *
 * Primary metric: smoothedThighLiftDeg = thighLiftDeg(hip, knee).
 *   0° at rest (knee under hip), 60°+ at full lift (thigh near-horizontal).
 *
 * Active leg: whichever of left/right has the higher thighLiftDeg each frame
 * — unilateral reps are detected automatically.
 *
 * State machine (4-state):
 *   AT_REST    (rawThighLiftDeg ≤ 10°)
 *   → LIFTING  (smoothedThighLiftDeg > 15°)
 *   → AT_TOP   (smoothedThighLiftDeg ≥ 45° for 5 stable frames)
 *   → RETURNING (drops 12° from peak)
 *   → AT_REST  (rawThighLiftDeg < 10°, rep complete)
 *
 * Warnings:
 *   'incomplete-fire-hydrant' — peak thighLiftDeg < 35° at rep completion
 *   'malformed-rep'           — too-fast / ballistic / too-slow
 *   'not-moving'              — 5s idle at AT_REST (Fix I + Fix P + Fix O)
 *   'position-lost'           — no usable pose frame for ≥ 3s (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { FireHydrantCalibration } from './calibration';
import type {
  FireHydrantBaseline,
  FireHydrantEngineCallbacks,
  FireHydrantFrameMetrics,
  FireHydrantRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { thighLiftDeg as computeThighLiftDeg } from './geometry';
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
// Tunable constants
// ---------------------------------------------------------------------------
const EMA_ALPHA = 0.15;

const LIFT_START_DEG = 15;                // smoothedThighLiftDeg > this → begin LIFTING
const AT_TOP_THRESHOLD_DEG = 45;          // smoothedThighLiftDeg >= this → AT_TOP candidate
const AT_TOP_STABILITY_FRAMES = 5;
// RAW threshold for returning to rest
const AT_REST_THRESHOLD_RAW = 10;
const ASCENT_FROM_PEAK_DEG = 12;          // drop this much from peak → RETURNING
const ASCENDING_DELTA_MIN = 3;

const MIN_REP_DEPTH_DEG = 35;             // peak must exceed this for valid rep
const MIN_REP_DURATION_MS = 500;
const MAX_REP_DURATION_MS = 10000;
const MAX_LIMB_VELOCITY = 2.0;            // ballistic gate (hip-Y velocity proxy)

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix I + Fix P: idle detection
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class FireHydrantEngine {
  private callbacks: FireHydrantEngineCallbacks;
  private calibration: FireHydrantCalibration;
  private baseline: FireHydrantBaseline | null = null;

  private repState: FireHydrantRepState = 'AT_REST';
  private activeLeg: 'left' | 'right' | null = null;
  private rawThighLiftDeg = 0;          // un-smoothed, for AT_REST_THRESHOLD_RAW check
  private smoothedThighLiftDeg = 0;
  private prevSmoothedThighLiftDeg = 0;
  private maxThighLiftThisRep = 0;
  private atTopCount = 0;
  private repStartedAt = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { hipOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  // Fix I + Fix O: idle detection
  private restingSince = 0;
  private restingFlexionMin = Infinity;
  private restingFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: post-rep EMA-decay reseed
  private restingSettledSince = 0;
  private restingBaselineReseeded = false;

  // Fix N: position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: FireHydrantEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new FireHydrantCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I + Fix O: initialize idle tracking on cal-confirm
        this.restingSince = now;
        this.restingFlexionMin = this.smoothedThighLiftDeg;
        this.restingFlexionMax = this.smoothedThighLiftDeg;
        this.restingSettledSince = 0;
        this.restingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('FH', 'CALIB', 'CONFIRMED', { bodyLength: +this.baseline.bodyLength.toFixed(3) });
        }
      }
      return;
    }

    // Fix N: post-cal position-lost check (runs regardless of landmark quality)
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'AT_REST';
    this.activeLeg = null;
    this.rawThighLiftDeg = 0;
    this.smoothedThighLiftDeg = 0;
    this.prevSmoothedThighLiftDeg = 0;
    this.atTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const ls = landmarks[LEFT_SHOULDER];
    const rs = landmarks[RIGHT_SHOULDER];
    const lh = landmarks[LEFT_HIP];
    const rh = landmarks[RIGHT_HIP];
    const lk = landmarks[LEFT_KNEE];
    const rk = landmarks[RIGHT_KNEE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh)
      && lmVisible(lk) && lmVisible(rk);
    if (!coreOk) return;

    // Compute thigh lift for both legs
    const leftLift  = computeThighLiftDeg(lh, lk);
    const rightLift = computeThighLiftDeg(rh, rk);

    // While AT_REST: track max of both legs to detect next rep onset.
    // Once locked into a rep, track only the active leg.
    const activeLift = this.activeLeg === 'left' ? leftLift
      : this.activeLeg === 'right' ? rightLift
      : Math.max(leftLift, rightLift);

    this.rawThighLiftDeg = activeLift;

    // EMA smoothing (Fix B10: === 0 init is load-bearing for ballistic detection)
    this.smoothedThighLiftDeg = this.smoothedThighLiftDeg === 0
      ? activeLift
      : EMA_ALPHA * activeLift + (1 - EMA_ALPHA) * this.smoothedThighLiftDeg;

    // Hip Y velocity for smoothness score
    const hipMidY = (lh.y + rh.y) / 2;
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (hipMidY - this.prevHipY) / dt;
        if (this.repState === 'LIFTING' || this.repState === 'RETURNING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = hipMidY;
    this.prevHipTimestamp = now;

    // Form accumulation (only during active rep)
    if (this.repState !== 'AT_REST') {
      this.repFormCounts.totalCount++;
      this.repFormCounts.hipOKCount++;
    }

    // Fix A: no form coaching warnings for fire hydrant (no posture-deviation warnings yet)

    this.checkNoMovement(now);
    this.advanceRepState(now, leftLift, rightLift);

    const frameMetrics: FireHydrantFrameMetrics = {
      thighLiftDeg: this.rawThighLiftDeg,
      smoothedThighLiftDeg: this.smoothedThighLiftDeg,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedThighLiftDeg = this.smoothedThighLiftDeg;
  }

  // ----------------------------------------------------------
  private advanceRepState(
    now: number,
    leftLift: number,
    rightLift: number,
  ): void {
    switch (this.repState) {
      case 'AT_REST':
        if (this.smoothedThighLiftDeg > LIFT_START_DEG) {
          // Lock active leg — whichever raw lift is higher
          this.activeLeg = leftLift >= rightLift ? 'left' : 'right';
          this.repState = 'LIFTING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('FH', 'STATE', 'AT_REST → LIFTING', {
            activeLeg: this.activeLeg,
            leftLift: +leftLift.toFixed(1),
            rightLift: +rightLift.toFixed(1),
          });
        }
        break;

      case 'LIFTING': {
        this.maxThighLiftThisRep = Math.max(this.maxThighLiftThisRep, this.smoothedThighLiftDeg);
        if (this.smoothedThighLiftDeg >= AT_TOP_THRESHOLD_DEG) {
          this.atTopCount++;
          if (this.atTopCount >= AT_TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('FH', 'STATE', 'LIFTING → AT_TOP', { peak: +this.maxThighLiftThisRep.toFixed(1) });
          }
        } else {
          this.atTopCount = 0;
          // Detect reversal below AT_TOP — same path as donkey kick's KICKING state.
          // Allows shallow reps to still flow through RETURNING → completeRep (rejected as too-shallow).
          const dropFromPeak = this.maxThighLiftThisRep - this.smoothedThighLiftDeg;
          const delta = this.smoothedThighLiftDeg - this.prevSmoothedThighLiftDeg;
          if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || delta < -ASCENDING_DELTA_MIN) {
            this.repState = 'RETURNING';
            debugLog('FH', 'STATE', 'LIFTING → RETURNING (below threshold)', {
              peak: +this.maxThighLiftThisRep.toFixed(1),
              dropFromPeak: +dropFromPeak.toFixed(1),
            });
          }
        }
        break;
      }

      case 'AT_TOP': {
        this.maxThighLiftThisRep = Math.max(this.maxThighLiftThisRep, this.smoothedThighLiftDeg);
        const dropFromPeak = this.maxThighLiftThisRep - this.smoothedThighLiftDeg;
        const delta = this.smoothedThighLiftDeg - this.prevSmoothedThighLiftDeg;
        if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || delta < -ASCENDING_DELTA_MIN) {
          this.repState = 'RETURNING';
          debugLog('FH', 'STATE', 'AT_TOP → RETURNING', { peak: +this.maxThighLiftThisRep.toFixed(1) });
        }
        break;
      }

      case 'RETURNING':
        // Use raw (un-smoothed) for return-to-rest check. EMA lag would prevent
        // the smoothed from reaching near-zero in normal rep cycles.
        if (this.rawThighLiftDeg < AT_REST_THRESHOLD_RAW) {
          this.completeRep(now);
          this.repState = 'AT_REST';
          this.activeLeg = null;
          this.atTopCount = 0;
          // Reset EMA to current raw value to avoid immediately re-triggering LIFTING.
          this.smoothedThighLiftDeg = this.rawThighLiftDeg;
          this.prevSmoothedThighLiftDeg = this.rawThighLiftDeg;
          // Fix O: reset idle tracking after rep
          this.restingSince = now;
          this.restingFlexionMin = Infinity;
          this.restingFlexionMax = -Infinity;
          this.restingSettledSince = 0;
          this.restingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.maxThighLiftThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt > MAX_REP_DURATION_MS) {
      return { ok: false, reason: 'too-slow' };
    }
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_LIMB_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('FH', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peak: +this.maxThighLiftThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        activeLeg: this.activeLeg,
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-fire-hydrant', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxThighLiftThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxThighLiftThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('FH', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // Fix I + Fix O: idle / no-movement detection
  private checkNoMovement(now: number): void {
    if (this.repState !== 'AT_REST') {
      this.restingSince = now;
      this.restingFlexionMin = this.smoothedThighLiftDeg;
      this.restingFlexionMax = this.smoothedThighLiftDeg;
      this.restingSettledSince = 0;
      this.restingBaselineReseeded = false;
      return;
    }

    if (this.smoothedThighLiftDeg < this.restingFlexionMin) this.restingFlexionMin = this.smoothedThighLiftDeg;
    if (this.smoothedThighLiftDeg > this.restingFlexionMax) this.restingFlexionMax = this.smoothedThighLiftDeg;

    // Fix O: EMA-decay reseed — once settled for 500ms, rebatch min/max
    if (!this.restingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedThighLiftDeg - this.prevSmoothedThighLiftDeg);
      if (emaDelta < 0.3) {
        if (this.restingSettledSince === 0) this.restingSettledSince = now;
        if (now - this.restingSettledSince >= 500) {
          this.restingFlexionMin = this.smoothedThighLiftDeg;
          this.restingFlexionMax = this.smoothedThighLiftDeg;
          this.restingSince = now;
          this.restingBaselineReseeded = true;
        }
      } else {
        this.restingSettledSince = 0;
      }
    }

    const idleMs = now - this.restingSince;
    const variance = this.restingFlexionMax - this.restingFlexionMin;
    // Fix P: cold-start cooldown — treat initial 0 as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('FH', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.restingSince = now;
      this.restingFlexionMin = this.smoothedThighLiftDeg;
      this.restingFlexionMax = this.smoothedThighLiftDeg;
      this.restingSettledSince = 0;
      this.restingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxThighLiftThisRep = 0;
    this.atTopCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { hipOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('FH', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // Fix N: position-lost detection
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LEFT_SHOULDER]) && lmVisible(landmarks[RIGHT_SHOULDER])
      && lmVisible(landmarks[LEFT_HIP]) && lmVisible(landmarks[RIGHT_HIP])
      && lmVisible(landmarks[LEFT_KNEE]) && lmVisible(landmarks[RIGHT_KNEE]);
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
    debugLog('FH', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
