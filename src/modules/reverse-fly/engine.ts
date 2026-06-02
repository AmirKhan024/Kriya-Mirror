/**
 * ReverseFlyEngine — bilateral arm tracker for front-camera reverse fly.
 *
 * State machine:
 *   DOWN     (avg armLiftDeg ≤ DOWN_THRESHOLD_DEG — arms hanging at sides)
 *   RAISING  (avg smoothedLiftDeg rises past RAISE_START_DEG)
 *   AT_TOP   (avg smoothedLiftDeg ≥ AT_TOP_THRESHOLD_DEG for AT_TOP_STABILITY_FRAMES stable frames)
 *   LOWERING (avg smoothedLiftDeg drops ASCENT_FROM_PEAK_DEG from peak)
 *   DOWN     (rep complete when raw armLiftDeg returns below DOWN_THRESHOLD_DEG)
 *
 * Y-axis note: MediaPipe Y=0 at TOP, Y=1 at BOTTOM.
 *   Arms hanging: wrist.y > shoulder.y (numerically larger Y = lower on screen)
 *   Arms at fly position: wrist.y approaches shoulder.y
 *   armLiftDeg = atan2(|dx|, dy): 0° at rest, 90° when wrists at shoulder level
 *
 * Posture warnings:
 *   incomplete-reverse-fly — rep closed but bilateral average peak < 50°
 *   malformed-rep          — rep < 500ms OR velocity spike > 3.5
 *   not-moving             — idle > 5s in DOWN state
 *   position-lost          — no usable frame ≥ 3s post-cal (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, armLiftDeg } from './geometry';
import { ReverseFlyCalibration } from './calibration';
import type {
  ReverseFlyBaseline, ReverseFlyEngineCallbacks, ReverseFlyFrameMetrics, ReverseFlyRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ── EMA ──────────────────────────────────────────────────────────────────────
const EMA_ALPHA = 0.20;

// ── State machine thresholds (armLiftDeg in degrees) ─────────────────────────
const RAISE_START_DEG = 15;              // armLiftDeg > 15 → transition DOWN → RAISING
const AT_TOP_THRESHOLD_DEG = 60;         // armLiftDeg ≥ 60 → AT_TOP candidate
const AT_TOP_STABILITY_FRAMES = 5;
const DOWN_THRESHOLD_DEG = 12;           // armLiftDeg < 12 → back to DOWN (rep complete)
const ASCENT_FROM_PEAK_DEG = 12;         // drop from peak → LOWERING

// ── Rep validation ────────────────────────────────────────────────────────────
const MIN_REP_DEPTH_DEG = 50;            // bilateral average peak must exceed 50° for valid rep
const MIN_REP_DURATION_MS = 500;         // reverse fly is a controlled 1-2s movement
const MAX_ARM_VELOCITY = 3.5;            // wrists travel further than hips; same scale as lateral-raise

// ── Bilateral symmetry ────────────────────────────────────────────────────────
const MIN_BILATERAL_SYMMETRY = 0.60;     // min(peakL, peakR) / avg(peakL, peakR) must be ≥ 0.60

// ── Form warnings ─────────────────────────────────────────────────────────────
const ASYMMETRY_DEBOUNCE_FRAMES = 8;     // frames before asymmetry fires (brief imbalance = noise)
void ASYMMETRY_DEBOUNCE_FRAMES;          // used in future per-frame asymmetry detection

// ── Cross-cutting ─────────────────────────────────────────────────────────────
const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;      // same as lateral-raise
const NO_MOVEMENT_REPEAT_MS = 15000;
const POSITION_LOST_TIMEOUT_MS = 3000;  // Fix N
const POSITION_LOST_REPEAT_MS = 10_000; // Fix N

export class ReverseFlyEngine {
  private callbacks: ReverseFlyEngineCallbacks;
  private calibration: ReverseFlyCalibration;
  private baseline: ReverseFlyBaseline | null = null;

  private repState: ReverseFlyRepState = 'DOWN';

  // Per-arm smoothed lift (degrees)
  private smoothedLiftL = 0;
  private smoothedLiftR = 0;
  private prevSmoothedLift = 0;
  private stableTopCount = 0;
  private peakLift = -Infinity;

  // Per-arm peak tracking (for bilateral symmetry check at rep close)
  private peakLiftL = -Infinity;
  private peakLiftR = -Infinity;

  // Wrist velocities for smoothness score
  private repWristVelocities: number[] = [];
  private prevAvgWristY = 0;
  private prevWristTimestamp = 0;

  // Rep form counts
  private repFormCounts = { symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private repStartedAt = 0;

  // Idle detection (DOWN state only)
  private downSince = 0;
  private downLiftMin = Infinity;
  private downLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: post-rep EMA-decay reseed
  private restSettledSince = 0;
  private restBaselineReseeded = false;

  // Fix N: position-lost heartbeat
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: ReverseFlyEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new ReverseFlyCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I: seed idle tracking on cal-confirm
        this.downSince = now;
        this.downLiftMin = 0;
        this.downLiftMax = 0;
        // Fix O: seed reseed flags
        this.restSettledSince = 0;
        this.restBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('REVFLY', 'CALIB', 'CONFIRMED', {
            shoulderMidX: +this.baseline.shoulderMidX.toFixed(3),
            shoulderMidY: +this.baseline.shoulderMidY.toFixed(3),
            hipMidY: +this.baseline.hipMidY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs BEFORE the early-return guard
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'DOWN';
    this.smoothedLiftL = 0;
    this.smoothedLiftR = 0;
    this.prevSmoothedLift = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ─────────────────────────────────────────────────────────────────────────
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lw) && lmVisible(rw);
    if (!coreOk) return;

    // Compute per-arm lift angle (degrees)
    const rawLiftL = armLiftDeg(ls, lw);
    const rawLiftR = armLiftDeg(rs, rw);

    // EMA init on first frame
    this.smoothedLiftL = this.smoothedLiftL === 0
      ? rawLiftL
      : EMA_ALPHA * rawLiftL + (1 - EMA_ALPHA) * this.smoothedLiftL;
    this.smoothedLiftR = this.smoothedLiftR === 0
      ? rawLiftR
      : EMA_ALPHA * rawLiftR + (1 - EMA_ALPHA) * this.smoothedLiftR;

    const smoothedLift = (this.smoothedLiftL + this.smoothedLiftR) / 2;

    // Wrist Y velocity for smoothness (distal end, high arc)
    const avgWristY = (lw.y + rw.y) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (avgWristY - this.prevAvgWristY) / dt;
        if (this.repState !== 'DOWN') {
          this.repWristVelocities.push(Math.abs(v));
        }
      }
    }
    this.prevAvgWristY = avgWristY;
    this.prevWristTimestamp = now;

    // Per-arm bilateral symmetry during active rep
    // Simple ratio check: both arms should contribute similarly
    const liftSum = this.smoothedLiftL + this.smoothedLiftR;
    const symmetryOK = liftSum < 5 || (
      Math.min(this.smoothedLiftL, this.smoothedLiftR) /
      (liftSum / 2) >= MIN_BILATERAL_SYMMETRY
    );

    // Accumulate form during active rep phases
    if (this.repState !== 'DOWN') {
      this.repFormCounts.totalCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    // Track bilateral peaks during active rep
    if (this.repState !== 'DOWN') {
      this.peakLiftL = Math.max(this.peakLiftL, this.smoothedLiftL);
      this.peakLiftR = Math.max(this.peakLiftR, this.smoothedLiftR);
    }

    this.checkNoMovement(now);
    this.advanceRepState(smoothedLift, now);

    const frameMetrics: ReverseFlyFrameMetrics = {
      smoothedLiftL: this.smoothedLiftL,
      smoothedLiftR: this.smoothedLiftR,
      smoothedLift,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedLift = smoothedLift;
  }

  // ─────────────────────────────────────────────────────────────────────────
  private advanceRepState(smoothedLift: number, now: number): void {
    switch (this.repState) {
      case 'DOWN':
        // Enter RAISING when avg lift rises above RAISE_START_DEG
        if (smoothedLift > RAISE_START_DEG) {
          this.repState = 'RAISING';
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('REVFLY', 'STATE', 'DOWN → RAISING', { lift: +smoothedLift.toFixed(1) });
        }
        break;

      case 'RAISING': {
        // Track peak lift this rep
        if (smoothedLift > this.peakLift) {
          this.peakLift = smoothedLift;
        }
        // Short-circuit: arm came back down without reaching AT_TOP → incomplete
        if (smoothedLift < DOWN_THRESHOLD_DEG) {
          debugLog('REVFLY', 'STATE', 'RAISING → DOWN (aborted)', { peak: +this.peakLift.toFixed(1) });
          this.maybeEmitWarning('incomplete-reverse-fly' as WarningType, true, now);
          this.resetRepBuffers();
          this.repState = 'DOWN';
          this.downSince = now;
          this.downLiftMin = Infinity;
          this.downLiftMax = -Infinity;
          this.restSettledSince = 0;
          this.restBaselineReseeded = false;
          break;
        }
        // Check for AT_TOP stability
        const delta = Math.abs(smoothedLift - this.prevSmoothedLift);
        if (smoothedLift >= AT_TOP_THRESHOLD_DEG) {
          if (delta < 3) {
            this.stableTopCount++;
            if (this.stableTopCount >= AT_TOP_STABILITY_FRAMES) {
              this.repState = 'AT_TOP';
              debugLog('REVFLY', 'STATE', 'RAISING → AT_TOP', { peak: +this.peakLift.toFixed(1) });
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
        if (smoothedLift > this.peakLift) {
          this.peakLift = smoothedLift;
        }
        const dropFromPeak = this.peakLift - smoothedLift;
        const deltaDown = this.prevSmoothedLift - smoothedLift;
        if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || deltaDown > 3) {
          this.repState = 'LOWERING';
          debugLog('REVFLY', 'STATE', 'AT_TOP → LOWERING', { peak: +this.peakLift.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        // Rep complete when arms return below DOWN_THRESHOLD_DEG
        if (smoothedLift < DOWN_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'DOWN';
          this.downSince = now;
          this.downLiftMin = Infinity;
          this.downLiftMax = -Infinity;
          // Fix O: reset reseed flags on rep completion
          this.restSettledSince = 0;
          this.restBaselineReseeded = false;
        }
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 1. Bilateral symmetry — Fix B1: use peakSum > 0 (NOT &&)
    const peakSum = this.peakLiftL + this.peakLiftR;
    if (peakSum > 0) {
      const ratio = Math.min(this.peakLiftL, this.peakLiftR) / (peakSum / 2);
      if (ratio < MIN_BILATERAL_SYMMETRY) {
        return { ok: false, reason: 'bilateral-asymmetry' };
      }
    }
    // 2. Shape/depth check — incomplete-reverse-fly if bilateral average peak < 50°
    if ((peakSum / 2) < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'incomplete' };
    }
    // 3. Duration gate
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    // 4. Ballistic spike
    if (this.repWristVelocities.length > 0) {
      const peakV = Math.max(...this.repWristVelocities);
      if (peakV > MAX_ARM_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('REVFLY', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakLift: +this.peakLift.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.peakLiftL.toFixed(1),
        rightPeak: +this.peakLiftR.toFixed(1),
      });
      if (validation.reason === 'incomplete') {
        this.maybeEmitWarning('incomplete-reverse-fly' as WarningType, true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore((this.peakLiftL + this.peakLiftR) / 2);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(((this.peakLiftL + this.peakLiftR) / 2) * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('REVFLY', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ─────────────────────────────────────────────────────────────────────────
  private checkNoMovement(now: number): void {
    // Fix O: reset tracking when not in DOWN state (active rep)
    if (this.repState !== 'DOWN') {
      this.downSince = now;
      this.downLiftMin = (this.smoothedLiftL + this.smoothedLiftR) / 2;
      this.downLiftMax = (this.smoothedLiftL + this.smoothedLiftR) / 2;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
      return;
    }

    const smoothedLift = (this.smoothedLiftL + this.smoothedLiftR) / 2;

    if (smoothedLift < this.downLiftMin) this.downLiftMin = smoothedLift;
    if (smoothedLift > this.downLiftMax) this.downLiftMax = smoothedLift;

    // Fix O: EMA reseed after rep — once the EMA has settled post-rep,
    // reseed the min/max so the decay tail does not permanently inflate variance.
    if (!this.restBaselineReseeded) {
      const emaDelta = Math.abs(smoothedLift - this.prevSmoothedLift);
      if (emaDelta < 0.5) {
        if (this.restSettledSince === 0) this.restSettledSince = now;
        if (now - this.restSettledSince >= 500) {
          this.downLiftMin = smoothedLift;
          this.downLiftMax = smoothedLift;
          this.downSince = now;
          this.restBaselineReseeded = true;
        }
      } else {
        this.restSettledSince = 0;
      }
    }

    const idleMs = now - this.downSince;
    const variance = this.downLiftMax - this.downLiftMin;

    // Fix P: treat lastNoMovementWarnAt === 0 as "never fired" sentinel
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS && variance < NO_MOVEMENT_VARIANCE_DEG && firstFireAllowed) {
      this.lastNoMovementWarnAt = now;
      debugLog('REVFLY', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      // Reset tracking to avoid repeat fires immediately
      this.downSince = now;
      this.downLiftMin = smoothedLift;
      this.downLiftMax = smoothedLift;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  private resetRepBuffers(): void {
    this.peakLift = -Infinity;
    this.peakLiftL = -Infinity;
    this.peakLiftR = -Infinity;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('REVFLY', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fix N: position-lost detection
  // ─────────────────────────────────────────────────────────────────────────

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_WRIST]) && lmVisible(landmarks[LM.RIGHT_WRIST])
      && lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP]);
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
    debugLog('REVFLY', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
