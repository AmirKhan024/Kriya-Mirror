/**
 * PushupEngine — rep-based tracker for side-camera push-ups.
 *
 * Combines the squat engine's rep state machine (state transitions, hip
 * velocity → smoothness, validateRepShape gates, idle detection) with the
 * plank engine's side-camera baseline (auto-detected facing side, hip-line
 * for sag / pike). Primary metric is elbow flexion (shoulder-elbow-wrist).
 *
 * State machine:
 *   TOP (flex ≤ 18°) → LOWERING (flex > 25°) → AT_BOTTOM (stable 8+ frames at
 *   low Δ) → PUSHING (flex dropping by ASCENT_FROM_PEAK_DEG or 3°+ per frame)
 *   → TOP (flex < 18°, rep complete).
 *
 * Tunable constants mirror squat's deep-squat-descend port with adjusted
 * thresholds for elbow flexion ranges (push-ups peak around 90°, not 130°).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, elbowFlexionDeg } from './geometry';
import { PushupCalibration } from './calibration';
import type {
  PushupBaseline, PushupEngineCallbacks, PushupFrameMetrics, PushupRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ELBOW = 0.15;
const DESCEND_START_DEG = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;
const TOP_THRESHOLD_DEG = 18;
// MIN_REP_DEPTH set to 50° rather than the 60° in the plan: with EMA(α=0.15)
// the smoothed elbow flex peak is ~55% of the input peak during a 200ms-cycle
// ballistic rep. Requiring 60° smoothed would mean shallow-reject ballistic reps
// (which we still want to count as REJECTED, but via the ballistic gate so the
// user gets the "slow down" malformed-rep cue rather than the "go deeper"
// incomplete-pushup cue). 50° is a fair floor for "this is a real push-up
// attempt" — anything shallower triggers incomplete-pushup.
const MIN_REP_DEPTH_DEG = 50;

// Hip-line gates (same convention as plank engine)
const HIP_SAG_THRESHOLD = 0.04;
const HIP_PIKE_THRESHOLD = 0.04;
// 2026-05-25 round 6: was 12° — fired on every rep in physical-test logs.
// 12° is geometrically coupled to HIP_SAG_THRESHOLD (atan(0.04/0.35)·2 ≈ 13°),
// so the moment hip-sag fired, spine-misaligned also fired (same signal twice).
// 22° catches only gross spinal folding beyond what hip-sag/hip-pike already
// covers.
const SPINE_DEVIATION_DEG = 22;
const HIP_DEBOUNCE_FRAMES = 6;

// Elbow-flare gate (side-view 2D heuristic: when bent past 60°, the elbow X
// should stay offset from shoulder X by at least ELBOW_FLARE_THRESHOLD —
// a smaller offset means the elbow is sticking outward toward the camera plane,
// which in side-view appears as elbow nearly under the shoulder).
const ELBOW_FLARE_THRESHOLD = 0.05;
const ELBOW_FLARE_DEBOUNCE_FRAMES = 10;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 5 (§3.7): 5s idle warning (was 12s). Mirrors squat's spec.
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Wrong-movement sanity gates (Tier 2 #7)
const MIN_REP_DURATION_MS = 400;
// 2026-05-25 round 6: was 1.5; single-frame MediaPipe jitter at the side-view
// regularly spikes shoulder Y velocity past 1.5 even on 3-second reps. 3.0
// still rejects genuine ballistic squat-style bounces (which peak ~1.7 in
// the squat ballistic test).
const MAX_SHOULDER_VELOCITY = 3.0;
const MIN_BILATERAL_SYMMETRY = 0.7;
// 2026-05-25 round 6: reps lasting longer than this are hesitation (user
// stuck mid-rep), not real push-ups. Physical-test log showed an 11-second
// "rep" — clearly a stalled attempt, not a controlled descent.
const MAX_REP_DURATION_MS = 6000;

export class PushupEngine {
  private callbacks: PushupEngineCallbacks;
  private calibration: PushupCalibration;
  private baseline: PushupBaseline | null = null;

  private repState: PushupRepState = 'TOP';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private repShoulderVelocities: number[] = [];
  private repFormCounts = { hipOKCount: 0, elbowOKCount: 0, spineOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevShoulderY = 0;
  private prevShoulderTimestamp = 0;

  private repStartedAt = 0;
  private repPeakLeftElbowDeg = 0;
  private repPeakRightElbowDeg = 0;

  // Idle detection
  private topSince = 0;
  private topFlexionMin = Infinity;
  private topFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  // Posture debounce counters
  private hipSagFrames = 0;
  private hipPikeFrames = 0;
  private spineBadFrames = 0;
  private elbowFlareFrames = 0;     // kept for future front-camera variant; always 0 here

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: PushupEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new PushupCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // 2026-05-25 round 5 (§3.7): initialize topSince on cal-confirm.
        // Without this, topSince stays at construction-time 0 and the first
        // post-cal frame reports idleMs = now - 0 = millions, instantly
        // firing 'not-moving'. Same bug pattern fixed in squat.
        this.topSince = now;
        this.topFlexionMin = this.smoothedFlexion;
        this.topFlexionMax = this.smoothedFlexion;
        if (this.baseline) {
          debugLog('PUSHUP', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            bodyLength: +this.baseline.bodyLength.toFixed(3),
          });
        }
      }
      return;
    }

    if (!landmarks || !this.baseline) return;
    this.processTrackingFrame(landmarks, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'TOP';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableBottomCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const elbow = landmarks[side === 'left' ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW];
    const wrist = landmarks[side === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    const otherShoulder = landmarks[side === 'left' ? LM.RIGHT_SHOULDER : LM.LEFT_SHOULDER];
    const otherElbow = landmarks[side === 'left' ? LM.RIGHT_ELBOW : LM.LEFT_ELBOW];
    const otherWrist = landmarks[side === 'left' ? LM.RIGHT_WRIST : LM.LEFT_WRIST];

    const coreOk = lmVisible(shoulder) && lmVisible(elbow) && lmVisible(wrist)
      && lmVisible(hip) && lmVisible(ankle);
    if (!coreOk) return;

    // Primary elbow flex from visible side
    const visibleFlex = elbowFlexionDeg(shoulder, elbow, wrist);
    // Other side flex (may be noisy or low-vis but still measurable)
    const otherFlex = (otherShoulder && otherElbow && otherWrist)
      ? elbowFlexionDeg(otherShoulder, otherElbow, otherWrist)
      : visibleFlex;

    const rawFlexion = visibleFlex;
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_ELBOW * rawFlexion + (1 - EMA_ALPHA_ELBOW) * this.smoothedFlexion;

    // Shoulder Y velocity (drives smoothness, since the shoulder is what visibly
    // travels during a push-up — wrists are planted, hips track the body line)
    if (this.prevShoulderTimestamp > 0) {
      const dt = (now - this.prevShoulderTimestamp) / 1000;
      if (dt > 0) {
        const v = (shoulder.y - this.prevShoulderY) / dt;
        if (this.repState === 'LOWERING' || this.repState === 'PUSHING') {
          this.repShoulderVelocities.push(v);
        }
      }
    }
    this.prevShoulderY = shoulder.y;
    this.prevShoulderTimestamp = now;

    // Hip-line deviation — line-relative metric.
    //
    // Push-up body drops as the rep deepens, so we CANNOT use plank's
    // `hip.y vs baseline.hipY` check (which assumes the body stays at a fixed
    // Y the whole time). Instead, we compare the hip's Y to where it SHOULD be
    // on the current shoulder→ankle line, computed each frame. This is
    // invariant to body height changes and isolates actual hip-line deviation.
    const ankleSpanX = ankle.x - shoulder.x;
    const expectedHipY = Math.abs(ankleSpanX) > 0.001
      ? shoulder.y + ((hip.x - shoulder.x) / ankleSpanX) * (ankle.y - shoulder.y)
      : (shoulder.y + ankle.y) / 2;
    const hipLineDelta = hip.y - expectedHipY;
    const sagging = hipLineDelta > HIP_SAG_THRESHOLD;
    const piked = hipLineDelta < -HIP_PIKE_THRESHOLD;

    // Spine deviation — shoulder→hip→ankle angle (atan2(cross, dot) — straight
    // line = 0°). Body lowers during rep so the angle is robust to height.
    const v1x = hip.x - shoulder.x, v1y = hip.y - shoulder.y;
    const v2x = ankle.x - hip.x, v2y = ankle.y - hip.y;
    const dotSpine = v1x * v2x + v1y * v2y;
    const crossSpine = Math.abs(v1x * v2y - v1y * v2x);
    const spineDeviation = Math.atan2(crossSpine, dotSpine) * (180 / Math.PI);
    const spineBad = spineDeviation > SPINE_DEVIATION_DEG;

    // Elbow flare — DISABLED for this side-camera variant.
    // A 2D side-view cannot reliably distinguish "elbow flared perpendicular
    // to body" (which projects to elbow nearly under shoulder) from "arms
    // straight" (which also projects to elbow under shoulder). Both produce
    // identical 2D landmark layouts. See
    // .context/03_KNOWN_ISSUES_TO_PREVENT.md → B8.
    // The detection is kept structurally so that a future front-camera variant
    // can reuse this engine with a real elbow-flare metric.
    void ELBOW_FLARE_THRESHOLD; void ELBOW_FLARE_DEBOUNCE_FRAMES;
    const elbowFlaredRaw = false;
    void elbow;

    // Debounce
    this.hipSagFrames = sagging ? this.hipSagFrames + 1 : 0;
    this.hipPikeFrames = piked ? this.hipPikeFrames + 1 : 0;
    this.spineBadFrames = spineBad ? this.spineBadFrames + 1 : 0;
    this.elbowFlareFrames = elbowFlaredRaw ? this.elbowFlareFrames + 1 : 0;

    const hipSagWarn = this.hipSagFrames >= HIP_DEBOUNCE_FRAMES;
    const hipPikeWarn = this.hipPikeFrames >= HIP_DEBOUNCE_FRAMES;
    const spineWarn = this.spineBadFrames >= HIP_DEBOUNCE_FRAMES;
    const elbowFlareWarn = this.elbowFlareFrames >= ELBOW_FLARE_DEBOUNCE_FRAMES;

    // Form accumulation during active push-up phases
    if (this.repState !== 'TOP') {
      this.repFormCounts.totalCount++;
      if (!hipSagWarn && !hipPikeWarn) this.repFormCounts.hipOKCount++;
      if (!elbowFlareWarn) this.repFormCounts.elbowOKCount++;
      if (!spineWarn) this.repFormCounts.spineOKCount++;
    }

    if (hipSagWarn) this.repWarnings.add('hip-sag');
    if (hipPikeWarn) this.repWarnings.add('hip-pike');
    if (spineWarn) this.repWarnings.add('spine-misaligned');
    void elbowFlareWarn;

    // 2026-05-25 round 5 (Fix A): only coach form during the active rep phase.
    // Between reps the user is just resting in TOP — telling them "lift your
    // hips" is noise when they're not even pushing up. Tracking-validity
    // signals (not-moving) and rep-rejection signals (incomplete-pushup /
    // malformed-rep) stay ungated.
    const inActiveRep = this.repState !== 'TOP';
    if (inActiveRep) {
      this.maybeEmitWarning('hip-sag', hipSagWarn, now);
      this.maybeEmitWarning('hip-pike', hipPikeWarn, now);
      this.maybeEmitWarning('spine-misaligned', spineWarn, now);
    }

    // Per-rep bilateral peak (for symmetry sanity check)
    if (this.repState !== 'TOP') {
      if (visibleFlex > this.repPeakLeftElbowDeg) this.repPeakLeftElbowDeg = visibleFlex;
      if (otherFlex > this.repPeakRightElbowDeg) this.repPeakRightElbowDeg = otherFlex;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: PushupFrameMetrics = {
      elbowFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      hipSagAmount: Math.max(0, hipLineDelta),
      hipPikeAmount: Math.max(0, -hipLineDelta),
      elbowFlared: false,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'TOP':
        if (this.smoothedFlexion > DESCEND_START_DEG) {
          this.repState = 'LOWERING';
          // 2026-05-25 round 5 (Fix C): must reset FIRST, then set repStartedAt.
          // resetRepBuffers() zeros repStartedAt — calling it AFTER the
          // assignment immediately erased the timestamp, so every REP and
          // REJECT log reported durationMs: 0.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('PUSHUP', 'STATE', 'TOP → LOWERING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'LOWERING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('PUSHUP', 'STATE', 'LOWERING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -ASCENDING_DELTA_MIN || dropFromPeak >= ASCENT_FROM_PEAK_DEG) {
          this.repState = 'PUSHING';
          debugLog('PUSHUP', 'STATE', 'AT_BOTTOM → PUSHING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'PUSHING':
        if (this.smoothedFlexion < TOP_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'TOP';
          this.topSince = now;
          this.topFlexionMin = Infinity;
          this.topFlexionMax = -Infinity;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 2026-05-25 round 5 (Fix D): check unilateral FIRST. When left/right are
    // wildly asymmetric (e.g. leftPeak=33°, rightPeak=85°), the averaged
    // smoothed-flex reads as too-shallow and shadows the real unilateral
    // issue. peakSum > 0 — DO NOT use && — see Bug B1.
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
    // 2026-05-25 round 6 (Issue 3): catch hesitation. Reps lasting > 6s aren't
    // controlled descents — the user got stuck mid-rep. Distinct reason from
    // ballistic so the REJECT log surfaces the right diagnosis.
    if (this.repStartedAt > 0 && now - this.repStartedAt > MAX_REP_DURATION_MS) {
      return { ok: false, reason: 'too-slow' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('PUSHUP', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDepth: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.repPeakLeftElbowDeg.toFixed(1),
        rightPeak: +this.repPeakRightElbowDeg.toFixed(1),
      });
      if (validation.reason === 'too-shallow') {
        // Actionable feedback for the user
        this.maybeEmitWarning('incomplete-pushup', true, now);
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

    const repPayload = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('PUSHUP', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'TOP') {
      this.topSince = now;
      this.topFlexionMin = this.smoothedFlexion;
      this.topFlexionMax = this.smoothedFlexion;
      return;
    }
    if (this.smoothedFlexion < this.topFlexionMin) this.topFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.topFlexionMax) this.topFlexionMax = this.smoothedFlexion;
    const idleMs = now - this.topSince;
    const variance = this.topFlexionMax - this.topFlexionMin;
    // 2026-05-25 round 5 (cold-start cooldown fix mirrored from squat):
    // `lastNoMovementWarnAt = 0` initially. If the engine timestamp `now` is
    // < NO_MOVEMENT_REPEAT_MS (15s) at first potential fire, the cooldown
    // check (now - 0 >= 15000) blocks it. Treat the initial 0 sentinel as
    // "never fired" and allow the first fire.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('PUSHUP', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.topSince = now;
      this.topFlexionMin = this.smoothedFlexion;
      this.topFlexionMax = this.smoothedFlexion;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableBottomCount = 0;
    this.repShoulderVelocities = [];
    this.repFormCounts = { hipOKCount: 0, elbowOKCount: 0, spineOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftElbowDeg = 0;
    this.repPeakRightElbowDeg = 0;
    this.hipSagFrames = 0;
    this.hipPikeFrames = 0;
    this.spineBadFrames = 0;
    this.elbowFlareFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('PUSHUP', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
