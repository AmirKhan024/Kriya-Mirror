/**
 * PullUpEngine — bilateral rep tracker for front-camera pull-up / chin-up.
 *
 * State machine (mirrors BicepCurlEngine's EXTENDED→CURLING→AT_TOP→LOWERING):
 *   HANGING  (avg elbow flex ≤ 20°)  — dead hang, arms fully extended
 *   PULLING  (avg flex > 25°)        — actively pulling up
 *   AT_TOP   (stable 8+ frames)      — chin at/above bar, peak flex reached
 *   LOWERING (flex dropping 3°+/fr)  — controlled descent back to hang
 *   → Returns to HANGING = rep complete.
 *
 * Posture warnings (emitted via onPostureWarning):
 *   - `incomplete-pullup`  — peak flex < 90° (chin never cleared bar)
 *   - `malformed-rep`      — kipping/ballistic (hip swing velocity too high)
 *   - `shoulder-shrug`     — shoulders elevate toward ears during rep
 *   - `not-moving`         — 5 s idle post-calibration
 *   - `position-lost`      — no usable landmarks for ≥ 3 s
 *   - `too-close` / `too-far` — calibration distance recheck
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, elbowFlexionDeg } from './geometry';
import { PullUpCalibration } from './calibration';
import type {
  PullUpBaseline, PullUpEngineCallbacks, PullUpFrameMetrics, PullUpRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ELBOW = 0.15;

// State-machine thresholds
const HANGING_THRESHOLD_DEG = 20;       // flex ≤ 20° = hanging (rest state)
const PULLING_START_DEG = 25;           // flex > 25° → enter PULLING
const TOP_STABILITY_FRAMES = 8;
const TOP_STABILITY_DELTA = 3;          // < 3°/frame change = stable at top
const DESCENDING_DELTA_MIN = 3;
const DESCENT_FROM_PEAK_DEG = 10;

const MIN_REP_DEPTH_DEG = 90;           // minimum flex for a valid rep

// Warning debounces
const SHOULDER_SHRUG_DEBOUNCE_FRAMES = 8;
const KIPPING_DEBOUNCE_FRAMES = 6;
// Shrug: ear-shoulder gap drops > 25% from baseline
const SHRUG_GAP_RATIO = 0.75;
// Kipping: hip lateral (X) displacement from baseline > this threshold
const HIP_SWING_THRESHOLD = 0.06;
// Ballistic velocity reference: shoulder Y velocity (similar to squat hip velocity)
// Pull-up shoulders travel ~0.15–0.25 normalized units; 3.0 rejects explosive momentum
// cheats while allowing 2–4 s controlled reps (verified analytically).
const MAX_SHOULDER_VELOCITY = 3.0;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 5 (§3.7): 5 s idle warning.
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// 2026-05-25 round 6: position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
const MIN_BILATERAL_SYMMETRY = 0.7;

export class PullUpEngine {
  private callbacks: PullUpEngineCallbacks;
  private calibration: PullUpCalibration;
  private baseline: PullUpBaseline | null = null;

  private repState: PullUpRepState = 'HANGING';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableTopCount = 0;
  private maxFlexionThisRep = 0;
  private repShoulderVelocities: number[] = [];
  private repFormCounts = { noShrugCount: 0, noKippingCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  private prevShoulderY = 0;
  private prevShoulderTimestamp = 0;

  // Per-rep bilateral peak
  private repStartedAt = 0;
  private repPeakLeftElbowDeg = 0;
  private repPeakRightElbowDeg = 0;

  // Idle detection in HANGING state
  private hangingSince = 0;
  private hangingFlexionMin = Infinity;
  private hangingFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O (round 7): EMA-decay reseed after rep
  private hangingSettledSince = 0;
  private hangingBaselineReseeded = false;

  // Fix N (round 6): position-lost heartbeat
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counters
  private shoulderShrugFrames = 0;
  private kippingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: PullUpEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new PullUpCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I (round 5 §3.7): initialize idle tracking on cal-confirm.
        this.hangingSince = now;
        this.hangingFlexionMin = this.smoothedFlexion;
        this.hangingFlexionMax = this.smoothedFlexion;
        // Fix N (round 6): seed position-lost heartbeat.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('PULLUP', 'CALIB', 'CONFIRMED', {
            wristMidY: +this.baseline.wristMidY.toFixed(3),
            earShoulderGap: +this.baseline.earShoulderGap.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs before the landmark-null early-return.
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

  // ─────────────────────────────────────────────────────────────────
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(le) && lmVisible(re)
      && lmVisible(lw) && lmVisible(rw) && lmVisible(lh) && lmVisible(rh);
    if (!coreOk) return;

    // Bilateral elbow flex (same formula as bicep curl — arms are extended when hanging)
    const leftFlex = elbowFlexionDeg(ls, le, lw);
    const rightFlex = elbowFlexionDeg(rs, re, rw);
    const rawFlexion = (leftFlex + rightFlex) / 2;

    // EMA smoothing (Fix B10: keep === 0 init branch)
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_ELBOW * rawFlexion + (1 - EMA_ALPHA_ELBOW) * this.smoothedFlexion;

    // Shoulder Y velocity (drives smoothness / ballistic detection)
    const shoulderMidY = (ls.y + rs.y) / 2;
    if (this.prevShoulderTimestamp > 0) {
      const dt = (now - this.prevShoulderTimestamp) / 1000;
      if (dt > 0) {
        const v = (shoulderMidY - this.prevShoulderY) / dt;
        if (this.repState === 'PULLING' || this.repState === 'LOWERING') {
          this.repShoulderVelocities.push(v);
        }
      }
    }
    this.prevShoulderY = shoulderMidY;
    this.prevShoulderTimestamp = now;

    // Shoulder shrug detection — ear-shoulder gap shrinks vs baseline
    const leftEar = landmarks[LM.LEFT_EAR];
    const rightEar = landmarks[LM.RIGHT_EAR];
    const earMidY = (leftEar.y + rightEar.y) / 2;
    const currentEarShoulderGap = shoulderMidY - earMidY;
    const shrugActive = baseline.earShoulderGap > 0
      && currentEarShoulderGap < baseline.earShoulderGap * SHRUG_GAP_RATIO;
    this.shoulderShrugFrames = shrugActive ? this.shoulderShrugFrames + 1 : 0;
    const shoulderShrugWarn = this.shoulderShrugFrames >= SHOULDER_SHRUG_DEBOUNCE_FRAMES;

    // Kipping detection — hip X drift from baseline
    const hipMidX = (lh.x + rh.x) / 2;
    const hipSwing = Math.abs(hipMidX - baseline.hipMidX);
    const kippingActive = hipSwing > HIP_SWING_THRESHOLD;
    this.kippingFrames = kippingActive ? this.kippingFrames + 1 : 0;
    const kippingWarn = this.kippingFrames >= KIPPING_DEBOUNCE_FRAMES;

    // Bilateral symmetry (per-frame form score)
    const flexSum = leftFlex + rightFlex;
    const flexLo = Math.min(leftFlex, rightFlex);
    const flexHi = Math.max(leftFlex, rightFlex);
    const symmetryOK = flexSum < 10 || (flexHi > 0 && flexLo / flexHi >= MIN_BILATERAL_SYMMETRY);

    // Form accumulation during active rep phases
    if (this.repState !== 'HANGING') {
      this.repFormCounts.totalCount++;
      if (!shoulderShrugWarn) this.repFormCounts.noShrugCount++;
      if (!kippingWarn) this.repFormCounts.noKippingCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (shoulderShrugWarn) this.repWarnings.add('shoulder-shrug');
    if (kippingWarn) this.repWarnings.add('malformed-rep');

    // Fix A: gate form coaching warnings to active rep phase only.
    if (this.repState !== 'HANGING') {
      this.maybeEmitWarning('shoulder-shrug', shoulderShrugWarn, now);
      this.maybeEmitWarning('malformed-rep', kippingWarn, now);
    }

    // Per-rep bilateral peak tracking
    if (this.repState !== 'HANGING') {
      if (leftFlex > this.repPeakLeftElbowDeg) this.repPeakLeftElbowDeg = leftFlex;
      if (rightFlex > this.repPeakRightElbowDeg) this.repPeakRightElbowDeg = rightFlex;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: PullUpFrameMetrics = {
      elbowFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      leftElbowDeg: leftFlex,
      rightElbowDeg: rightFlex,
      shoulderShrug: shoulderShrugWarn,
      kipping: kippingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ─────────────────────────────────────────────────────────────────
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'HANGING':
        if (this.smoothedFlexion > PULLING_START_DEG) {
          this.repState = 'PULLING';
          // Fix C: reset FIRST, then set repStartedAt.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('PULLUP', 'STATE', 'HANGING → PULLING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'PULLING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('PULLUP', 'STATE', 'PULLING → AT_TOP', { peak: +this.maxFlexionThisRep.toFixed(1) });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_TOP': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -DESCENDING_DELTA_MIN || dropFromPeak >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('PULLUP', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedFlexion < HANGING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'HANGING';
          this.hangingSince = now;
          this.hangingFlexionMin = Infinity;
          this.hangingFlexionMax = -Infinity;
          this.hangingSettledSince = 0;
          this.hangingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: bilateral symmetry check BEFORE depth check.
    const peakSum = this.repPeakLeftElbowDeg + this.repPeakRightElbowDeg;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftElbowDeg, this.repPeakRightElbowDeg);
      const hi = Math.max(this.repPeakLeftElbowDeg, this.repPeakRightElbowDeg);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }
    if (this.maxFlexionThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repShoulderVelocities.length > 0) {
      const peakV = Math.max(...this.repShoulderVelocities.map(Math.abs));
      if (peakV > MAX_SHOULDER_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('PULLUP', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakAvg: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.repPeakLeftElbowDeg.toFixed(1),
        rightPeak: +this.repPeakRightElbowDeg.toFixed(1),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-pullup', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repShoulderVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxFlexionThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload: import('./types').PullUpRepEvent = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('PULLUP', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'HANGING') {
      // Active rep — reset idle window
      this.hangingSince = now;
      this.hangingFlexionMin = this.smoothedFlexion;
      this.hangingFlexionMax = this.smoothedFlexion;
      this.hangingSettledSince = 0;
      this.hangingBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.hangingFlexionMin) this.hangingFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.hangingFlexionMax) this.hangingFlexionMax = this.smoothedFlexion;

    // Fix O (round 7): reseed EMA baseline once settled after a rep.
    if (!this.hangingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.hangingSettledSince === 0) this.hangingSettledSince = now;
        if (now - this.hangingSettledSince >= 500) {
          this.hangingFlexionMin = this.smoothedFlexion;
          this.hangingFlexionMax = this.smoothedFlexion;
          this.hangingSince = now;
          this.hangingBaselineReseeded = true;
        }
      } else {
        this.hangingSettledSince = 0;
      }
    }

    const idleMs = now - this.hangingSince;
    const variance = this.hangingFlexionMax - this.hangingFlexionMin;
    // Fix P (round 5): cold-start cooldown sentinel.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('PULLUP', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.hangingSince = now;
      this.hangingFlexionMin = this.smoothedFlexion;
      this.hangingFlexionMax = this.smoothedFlexion;
      this.hangingSettledSince = 0;
      this.hangingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableTopCount = 0;
    this.repShoulderVelocities = [];
    this.repFormCounts = { noShrugCount: 0, noKippingCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftElbowDeg = 0;
    this.repPeakRightElbowDeg = 0;
    this.shoulderShrugFrames = 0;
    this.kippingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('PULLUP', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ─────────────────────────────────────────────────────────────────
  // Fix N (round 6): position-lost detection
  // ─────────────────────────────────────────────────────────────────

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_ELBOW])    && lmVisible(landmarks[LM.RIGHT_ELBOW])
      && lmVisible(landmarks[LM.LEFT_WRIST])    && lmVisible(landmarks[LM.RIGHT_WRIST])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP]);
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
    debugLog('PULLUP', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
