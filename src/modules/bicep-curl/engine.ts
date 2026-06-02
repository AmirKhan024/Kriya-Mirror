/**
 * BicepCurlEngine — bilateral rep tracker for front-camera bicep curl.
 *
 * Mirrors SquatEngine's 4-state machine with curl-specific renames:
 *   EXTENDED (avg flex ≤ 18°) → CURLING (avg flex > 25°) → AT_TOP (stable for
 *   8+ frames at low delta) → LOWERING (flex dropping by ASCENT_FROM_PEAK_DEG
 *   or 3°+ per frame) → EXTENDED (avg flex < 18°, rep complete).
 *
 * Tracks BOTH arms — the average of left + right elbow flex drives the state
 * machine. Bilateral symmetry gate (`peakSum > 0` per B1) rejects reps where
 * one arm dramatically lags the other.
 *
 * Posture warnings:
 *   - `torso-swing`     — shoulder-mid X oscillates > 0.04 from baseline (momentum cheat)
 *   - `elbow-drift`     — average elbow X drifts > 0.06 forward of baseline
 *   - `incomplete-curl` — rep complete but peak avg flex < MIN_REP_DEPTH_DEG
 *   - `malformed-rep`   — ballistic/too-fast/unilateral
 *   - `not-moving`      — 12s idle
 *   - `too-close` / `too-far` — calibration distance hints
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, elbowFlexionDeg } from './geometry';
import { BicepCurlCalibration } from './calibration';
import type {
  BicepCurlBaseline, BicepCurlEngineCallbacks, BicepCurlFrameMetrics, BicepCurlRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ELBOW = 0.15;
const ASCEND_START_DEG = 25;
const TOP_STABILITY_FRAMES = 8;
const TOP_STABILITY_DELTA = 3;
const DESCENDING_DELTA_MIN = 3;
const DESCENT_FROM_PEAK_DEG = 10;
const EXTENDED_THRESHOLD_DEG = 18;
const MIN_REP_DEPTH_DEG = 90;        // curl must reach ≥90° avg elbow flex

const TORSO_SWING_THRESHOLD = 0.04;   // shoulder-mid X deviation from baseline
const TORSO_SWING_DEBOUNCE_FRAMES = 8;
const ELBOW_DRIFT_THRESHOLD = 0.06;   // elbow X drift forward of baseline
const ELBOW_DRIFT_DEBOUNCE_FRAMES = 10;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 5 (§3.7): 5s idle warning (was 12s). Mirrors squat/lunge.
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// 2026-05-25 round 6: position-lost detection — fire if no usable pose frame
// for ≥ 3 s post-cal, repeat every 10 s while still lost.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
// 2026-05-25 round 8 (physical-test fix): was 1.5; single-frame MediaPipe
// jitter on the wrist (distal end of the kinematic chain, larger arc than
// hip/shoulder) regularly spikes peak wrist Y velocity past 1.5 even on
// 3–6 second reps, so "Slow down — control the descent" fires on properly-
// paced curls. 4.0 still rejects truly ballistic momentum-cheat curls
// (synthesized 130°→0° over <200 ms produces peak v ≈ 6.5).
const MAX_WRIST_VELOCITY = 4.0;
// MIN_BILATERAL_SYMMETRY = 0.7: a rep is "unilateral" (rejected as malformed)
// when the weaker arm's peak flex is < 70 % of the stronger arm's. Verified
// against physical-test logs: real two-arm reps land at > 0.95 ratio
// consistently; the only unilateral rejection observed had ratio 0.12
// (one arm at 21°, the other at 173°) — a genuine one-armed attempt.
const MIN_BILATERAL_SYMMETRY = 0.7;

export class BicepCurlEngine {
  private callbacks: BicepCurlEngineCallbacks;
  private calibration: BicepCurlCalibration;
  private baseline: BicepCurlBaseline | null = null;

  private repState: BicepCurlRepState = 'EXTENDED';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableTopCount = 0;
  private maxFlexionThisRep = 0;
  private repWristVelocities: number[] = [];
  private repFormCounts = { torsoOKCount: 0, elbowOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  // Per-rep tracking
  private repStartedAt = 0;
  private repPeakLeftElbowDeg = 0;
  private repPeakRightElbowDeg = 0;

  // Idle detection (no-movement in EXTENDED state)
  private extendedSince = 0;
  private extendedFlexionMin = Infinity;
  private extendedFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // 2026-05-25 round 7: post-rep EMA-decay reseed. Without this, smoothedFlexion
  // decays exponentially after a curl returns to EXTENDED, permanently inflating
  // max - min so `not-moving` never fires after a rep + rest. Same fix shipped
  // for lunge — see lunge/engine.ts `standingSettledSince`/`standingBaselineReseeded`.
  private extendedSettledSince = 0;
  private extendedBaselineReseeded = false;

  // 2026-05-25 round 6: position-lost detection (tracking-validity heartbeat)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counters
  private torsoSwingFrames = 0;
  private elbowDriftFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: BicepCurlEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new BicepCurlCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // 2026-05-25 round 5 (§3.7): initialize extendedSince + idle tracking
        // on cal-confirm. Without this the construction-time-0 value causes
        // an instant false-positive 'not-moving' on the first post-cal frame.
        this.extendedSince = now;
        this.extendedFlexionMin = this.smoothedFlexion;
        this.extendedFlexionMax = this.smoothedFlexion;
        // 2026-05-25 round 6: seed position-lost heartbeat too.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('CURL', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            leftElbowX: +this.baseline.leftElbowX.toFixed(3),
            rightElbowX: +this.baseline.rightElbowX.toFixed(3),
          });
        }
      }
      return;
    }

    // 2026-05-25 round 6: post-cal position-lost check runs regardless of
    // whether the current frame has usable landmarks (the whole point is to
    // detect missing frames).
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'EXTENDED';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(le) && lmVisible(re)
      && lmVisible(lw) && lmVisible(rw);
    if (!coreOk) return;

    // Bilateral elbow flex
    const leftElbow = elbowFlexionDeg(ls, le, lw);
    const rightElbow = elbowFlexionDeg(rs, re, rw);
    const rawFlexion = (leftElbow + rightElbow) / 2;

    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_ELBOW * rawFlexion + (1 - EMA_ALPHA_ELBOW) * this.smoothedFlexion;

    // Wrist Y velocity (drives smoothness — the wrist is what travels during a curl)
    const wristMidY = (lw.y + rw.y) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wristMidY - this.prevWristY) / dt;
        if (this.repState === 'CURLING' || this.repState === 'LOWERING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wristMidY;
    this.prevWristTimestamp = now;

    // Torso swing — shoulder midpoint x oscillates from baseline
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Elbow drift — average elbow X drifted forward of baseline
    // "Forward" in front-view is hard to disambiguate from "left/right", so we
    // measure absolute X drift from baseline elbow X for each arm.
    const leftElbowDrift = Math.abs(le.x - baseline.leftElbowX);
    const rightElbowDrift = Math.abs(re.x - baseline.rightElbowX);
    const elbowDriftActive = Math.max(leftElbowDrift, rightElbowDrift) > ELBOW_DRIFT_THRESHOLD;
    this.elbowDriftFrames = elbowDriftActive ? this.elbowDriftFrames + 1 : 0;
    const elbowDriftWarn = this.elbowDriftFrames >= ELBOW_DRIFT_DEBOUNCE_FRAMES;

    // Bilateral symmetry per-frame (current asymmetry — for the form-score)
    const flexSum = leftElbow + rightElbow;
    const flexLo = Math.min(leftElbow, rightElbow);
    const flexHi = Math.max(leftElbow, rightElbow);
    const symmetryOK = flexSum < 10 || (flexHi > 0 && flexLo / flexHi >= MIN_BILATERAL_SYMMETRY);

    // Form accumulation during active phases
    if (this.repState !== 'EXTENDED') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (!elbowDriftWarn) this.repFormCounts.elbowOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');
    if (elbowDriftWarn) this.repWarnings.add('elbow-drift');

    // 2026-05-25 round 5 (Fix A): gate form coaching to active rep phase.
    // Resting in EXTENDED between reps with a casual torso shift / elbow flop
    // shouldn't fire warnings — the user isn't curling, they're recovering.
    if (this.repState !== 'EXTENDED') {
      this.maybeEmitWarning('torso-swing', torsoSwingWarn, now);
      this.maybeEmitWarning('elbow-drift', elbowDriftWarn, now);
    }

    // Per-rep bilateral peak (for symmetry sanity check)
    if (this.repState !== 'EXTENDED') {
      if (leftElbow > this.repPeakLeftElbowDeg) this.repPeakLeftElbowDeg = leftElbow;
      if (rightElbow > this.repPeakRightElbowDeg) this.repPeakRightElbowDeg = rightElbow;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: BicepCurlFrameMetrics = {
      elbowFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      leftElbowDeg: leftElbow,
      rightElbowDeg: rightElbow,
      torsoSwing: torsoSwingWarn,
      elbowDrift: elbowDriftWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'EXTENDED':
        if (this.smoothedFlexion > ASCEND_START_DEG) {
          this.repState = 'CURLING';
          // 2026-05-25 round 5 (Fix C): reset FIRST, then set repStartedAt.
          // resetRepBuffers() zeros repStartedAt — calling it AFTER the
          // assignment immediately erased the timestamp, so every REP and
          // REJECT log reported durationMs: 0.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('CURL', 'STATE', 'EXTENDED → CURLING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'CURLING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('CURL', 'STATE', 'CURLING → AT_TOP', { peak: +this.maxFlexionThisRep.toFixed(1) });
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
          debugLog('CURL', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedFlexion < EXTENDED_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'EXTENDED';
          this.extendedSince = now;
          this.extendedFlexionMin = Infinity;
          this.extendedFlexionMax = -Infinity;
          this.extendedSettledSince = 0;
          this.extendedBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 2026-05-25 round 5 (Fix D): check unilateral / bilateral symmetry FIRST.
    // A deeply-curled-but-one-arm-only rep should be reported as malformed-rep
    // (unilateral), not incomplete-curl. Previously the depth check tripped
    // first and the more specific feedback was lost.
    // Bilateral symmetry — peakSum > 0 (NOT && — see B1 in known-issues)
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
      debugLog('CURL', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakAvg: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.repPeakLeftElbowDeg.toFixed(1),
        rightPeak: +this.repPeakRightElbowDeg.toFixed(1),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-curl', true, now);
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

    const repPayload = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('CURL', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'EXTENDED') {
      this.extendedSince = now;
      this.extendedFlexionMin = this.smoothedFlexion;
      this.extendedFlexionMax = this.smoothedFlexion;
      this.extendedSettledSince = 0;
      this.extendedBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.extendedFlexionMin) this.extendedFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.extendedFlexionMax) this.extendedFlexionMax = this.smoothedFlexion;
    // 2026-05-25 round 7: re-baseline once the EMA has settled, so the
    // post-rep decay tail (smoothedFlexion drifting from ~17° → resting ~10°)
    // doesn't permanently inflate `max - min`. Once per-frame change has been
    // under 0.3° for 500ms straight, drop the cached min/max and reseed from
    // the current value. Idle counting effectively starts from the settled point.
    if (!this.extendedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.extendedSettledSince === 0) this.extendedSettledSince = now;
        if (now - this.extendedSettledSince >= 500) {
          this.extendedFlexionMin = this.smoothedFlexion;
          this.extendedFlexionMax = this.smoothedFlexion;
          this.extendedSince = now;
          this.extendedBaselineReseeded = true;
        }
      } else {
        this.extendedSettledSince = 0;
      }
    }
    const idleMs = now - this.extendedSince;
    const variance = this.extendedFlexionMax - this.extendedFlexionMin;
    // 2026-05-25 round 5 (cold-start cooldown fix): lastNoMovementWarnAt = 0
    // initially. If the engine timestamp `now` is < NO_MOVEMENT_REPEAT_MS
    // (15s) at first potential fire, the cooldown blocks it. Treat the
    // initial 0 sentinel as "never fired" and allow the first fire.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('CURL', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.extendedSince = now;
      this.extendedFlexionMin = this.smoothedFlexion;
      this.extendedFlexionMax = this.smoothedFlexion;
      this.extendedSettledSince = 0;
      this.extendedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, elbowOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftElbowDeg = 0;
    this.repPeakRightElbowDeg = 0;
    this.torsoSwingFrames = 0;
    this.elbowDriftFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('CURL', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // 2026-05-25 round 6: position-lost detection
  // ----------------------------------------------------------

  /** Mirrors the coreOk check inside processTrackingFrame so the position-lost
   *  detection uses the same definition of "usable frame". Bicep curl's core
   *  set is shoulders + elbows + wrists + hips (no legs needed). */
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
    debugLog('CURL', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
