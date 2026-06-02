/**
 * SitToStandEngine — rep-based tracker for the Sit-to-Stand (side camera).
 *
 * Mechanically an INVERTED squat: the rest state is SEATED (knees flexed ~90°)
 * and the effortful peak is STANDING (knees ~straight). A rep is one stand-up.
 * Tracks the visible-side knee flexion (side-on, like chair-pose picks a side).
 *
 * State machine (hysteresis on absolute knee-flex angle):
 *   SEATED  → RISING   : smoothedFlex < RISE_START_DEG (user pushing up)
 *   RISING  → STANDING : smoothedFlex < STAND_CONFIRM_DEG → COUNT the rep
 *   RISING  → SEATED   : smoothedFlex > SEATED_ENTER_DEG → aborted (incomplete-stand)
 *   STANDING→ SEATED   : smoothedFlex > SEATED_ENTER_DEG (sat back down, re-arm)
 *
 * Warnings:
 *   - `incomplete-stand` — started rising but sat back down without standing
 *   - `malformed-rep`    — stood too fast (< 300 ms) or ballistic (hip velocity)
 *   - `not-moving`       — 5 s idle while seated (Fix I/O/P)
 *   - `position-lost`    — no usable pose frame for ≥ 3 s post-cal (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeFlexionDeg } from '@/modules/squat/geometry';
import { SitToStandCalibration } from './calibration';
import type {
  SitToStandBaseline, SitToStandEngineCallbacks, SitToStandFrameMetrics, SitToStandRepState,
} from './types';
import { computeMQS, getCompletionScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.15;

// Absolute knee-flexion thresholds (seated ~90°, standing ~5°).
const SEATED_ENTER_DEG = 60;     // flex above this = seated (rest / re-arm)
const RISE_START_DEG = 50;       // flex drops below this from seated → rising
const STAND_CONFIRM_DEG = 25;    // flex below this = stood up → count the rep

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_DEG = 0.3;
const SETTLED_HOLD_MS = 500;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// The RISE_START→STAND_CONFIRM window is narrow (EMA lag bunches the two
// thresholds near the top of the rise), so the duration floor is lower than
// squat's — the hip-velocity ballistic check is the primary momentum guard.
const MIN_REP_DURATION_MS = 200;
const MAX_HIP_VELOCITY = 1.5;

export class SitToStandEngine {
  private callbacks: SitToStandEngineCallbacks;
  private calibration: SitToStandCalibration;
  private baseline: SitToStandBaseline | null = null;

  private repState: SitToStandRepState = 'SEATED';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private seeded = false;

  private minFlexThisRep = Infinity;   // lowest flex reached (fullest stand)
  private startFlexThisRep = 0;        // seated flex when rising began
  private repStartedAt = 0;
  private repHipVelocities: number[] = [];
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  // Idle detection (SEATED rest state)
  private seatedSince = 0;
  private seatedFlexMin = Infinity;
  private seatedFlexMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private seatedSettledSince = 0;
  private seatedBaselineReseeded = false;

  // Position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: SitToStandEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SitToStandCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        this.seatedSince = now;
        this.seatedFlexMin = this.smoothedFlexion;
        this.seatedFlexMax = this.smoothedFlexion;
        this.seatedSettledSince = 0;
        this.seatedBaselineReseeded = false;
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('SIT2STAND', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            seatedFlex: +this.baseline.seatedKneeFlexDeg.toFixed(1),
          });
        }
      }
      return;
    }

    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'SEATED';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.seeded = false;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    if (!lmVisible(hip) || !lmVisible(knee) || !lmVisible(ankle)) return;

    const rawFlexion = kneeFlexionDeg(hip, knee, ankle);
    this.smoothedFlexion = this.seeded
      ? EMA_ALPHA_KNEE * rawFlexion + (1 - EMA_ALPHA_KNEE) * this.smoothedFlexion
      : rawFlexion;
    this.seeded = true;

    // Hip-Y velocity (smoothness) during the rise.
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0 && this.repState === 'RISING') {
        this.repHipVelocities.push((hip.y - this.prevHipY) / dt);
      }
    }
    this.prevHipY = hip.y;
    this.prevHipTimestamp = now;

    if (this.repState === 'RISING' && this.smoothedFlexion < this.minFlexThisRep) {
      this.minFlexThisRep = this.smoothedFlexion;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: SitToStandFrameMetrics = {
      kneeFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'SEATED':
        if (this.smoothedFlexion < RISE_START_DEG) {
          this.repState = 'RISING';
          this.resetRepBuffers();
          this.repStartedAt = now;
          this.startFlexThisRep = this.prevSmoothedFlexion;
          this.minFlexThisRep = this.smoothedFlexion;
          debugLog('SIT2STAND', 'STATE', 'SEATED → RISING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'RISING':
        if (this.smoothedFlexion < STAND_CONFIRM_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          debugLog('SIT2STAND', 'STATE', 'RISING → STANDING', { minFlex: +this.minFlexThisRep.toFixed(1) });
        } else if (this.smoothedFlexion > SEATED_ENTER_DEG) {
          // Sat back down without standing — aborted attempt.
          debugLog('SIT2STAND', 'REJECT', 'Rise aborted', { minFlex: +this.minFlexThisRep.toFixed(1) });
          this.maybeEmitWarning('incomplete-stand', true, now);
          this.repState = 'SEATED';
          this.enterSeated(now);
        }
        break;

      case 'STANDING':
        if (this.smoothedFlexion > SEATED_ENTER_DEG) {
          this.repState = 'SEATED';
          this.enterSeated(now);
          debugLog('SIT2STAND', 'STATE', 'STANDING → SEATED', {});
        }
        break;
    }
  }

  private enterSeated(now: number): void {
    this.seatedSince = now;
    this.seatedFlexMin = this.smoothedFlexion;
    this.seatedFlexMax = this.smoothedFlexion;
    this.seatedSettledSince = 0;
    this.seatedBaselineReseeded = false;
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
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
      debugLog('SIT2STAND', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        minFlex: +this.minFlexThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      this.maybeEmitWarning('malformed-rep', true, now);
      return;
    }

    // Range from the SEATED baseline (not the 50° rise threshold) to the fullest
    // stand — represents the true knee-extension achieved this rep.
    const seatedFlex = this.baseline?.seatedKneeFlexDeg ?? this.startFlexThisRep;
    const rangeDeg = Math.max(0, seatedFlex - this.minFlexThisRep);
    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = 100; // no separate 2D form sub-metric for the stand-up
    const completion = getCompletionScore(rangeDeg);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(rangeDeg * 10) / 10,
      smoothness: Math.round(smoothness),
      form,
      mqs: Math.round(mqs),
      warnings: [] as WarningType[],
    };
    debugLog('SIT2STAND', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'SEATED') {
      this.seatedSince = now;
      this.seatedFlexMin = this.smoothedFlexion;
      this.seatedFlexMax = this.smoothedFlexion;
      this.seatedSettledSince = 0;
      this.seatedBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.seatedFlexMin) this.seatedFlexMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.seatedFlexMax) this.seatedFlexMax = this.smoothedFlexion;
    // Fix O — reseed once the EMA has settled (post-rep decay tail).
    if (!this.seatedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < SETTLED_DELTA_DEG) {
        if (this.seatedSettledSince === 0) this.seatedSettledSince = now;
        if (now - this.seatedSettledSince >= SETTLED_HOLD_MS) {
          this.seatedFlexMin = this.smoothedFlexion;
          this.seatedFlexMax = this.smoothedFlexion;
          this.seatedSince = now;
          this.seatedBaselineReseeded = true;
        }
      } else {
        this.seatedSettledSince = 0;
      }
    }
    const idleMs = now - this.seatedSince;
    const variance = this.seatedFlexMax - this.seatedFlexMin;
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS && variance < NO_MOVEMENT_VARIANCE_DEG && firstFireAllowed) {
      this.lastNoMovementWarnAt = now;
      debugLog('SIT2STAND', 'WARN', 'not-moving', { idleMs: Math.round(idleMs), flexVariance: +variance.toFixed(2) });
      this.callbacks.onPostureWarning?.('not-moving');
      this.seatedSince = now;
      this.seatedFlexMin = this.smoothedFlexion;
      this.seatedFlexMax = this.smoothedFlexion;
      this.seatedSettledSince = 0;
      this.seatedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.minFlexThisRep = Infinity;
    this.startFlexThisRep = 0;
    this.repHipVelocities = [];
    this.repStartedAt = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('SIT2STAND', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const leftOk = lmVisible(lh) && lmVisible(lk) && lmVisible(la);
    const rightOk = lmVisible(rh) && lmVisible(rk) && lmVisible(ra);
    return leftOk || rightOk;
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
    debugLog('SIT2STAND', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
