/**
 * SquatEngine — pure-logic squat tracker.
 *
 * Mirrors the rep state machine, posture-warning gates, and scoring components
 * from `kriya-activities\mobility_new\deep_squat_descend\js\activity.js`.
 * No DOM, no audio — the React layer subscribes via callbacks and renders.
 *
 * Constants kept in sync with source (line refs in activity.js):
 *   EMA_ALPHA_KNEE = 0.15            (line 32)
 *   DESCEND_START = 25°              (line 37)
 *   BOTTOM_STABILITY_FRAMES = 8      (line 39)
 *   BOTTOM_STABILITY_DELTA = 3°      (line 40)
 *   ASCENDING_DELTA_MIN = 3°         (line 41)
 *   ASCENT_FROM_PEAK_DEG = 10°       (line 48)
 *   STANDING_THRESHOLD = 18°         (line 51)
 *   MIN_REP_DEPTH = 45°              (line 54)
 *   HEEL_LIFT_THRESHOLD = 0.032      (line 56)
 *   HEEL_LIFT_DEBOUNCE_FRAMES = 12   (line 58)
 *   VALGUS_DEBOUNCE_FRAMES = 10      (line 59)
 *   VALGUS_THRESHOLD_RATIO = 0.15    (line 61)
 *   TRUNK_WARN_DEG = 55              (line 64)
 *   FACING_WIDTH_MIN_RATIO = 0.50    (line 72)
 *   BODY_HEIGHT_MIN_RATIO = 0.28     (line 73)
 *   FEET_WIDTH_MIN_RATIO = 0.70      (line 75)
 *   FACING_WARN_FRAMES = 20          (line 76)
 *   DISTANCE_WARN_FRAMES = 20        (line 77)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM, lmVisible, midpoint, kneeFlexionDeg, trunkLeanDeg,
} from './geometry';
import { SquatCalibration } from './calibration';
import type {
  CalibrationBaseline, FrameMetrics, RepState, SquatEngineCallbacks,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.15;
const DESCEND_START = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;
const STANDING_THRESHOLD = 18;
const MIN_REP_DEPTH = 45;

const HEEL_LIFT_THRESHOLD = 0.032;
const HEEL_LIFT_DEBOUNCE_FRAMES = 12;
const VALGUS_THRESHOLD_RATIO = 0.15;
const VALGUS_DEBOUNCE_FRAMES = 10;
const TRUNK_WARN_DEG = 55;

const FACING_WIDTH_MIN_RATIO = 0.5;
const BODY_HEIGHT_MIN_RATIO = 0.28;
const FEET_WIDTH_MIN_RATIO = 0.7;
const FACING_WARN_FRAMES = 20;
const DISTANCE_WARN_FRAMES = 20;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// No-movement detection (mirrors source activity.js:74).
// 2026-05-25 round 5: user explicitly asked for 5s ("if user is idle for more
// than 5 seconds then a warning"). Previous 8s value was a guess; trusting
// the spec now.
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;       // smoothedFlexion varies < this over window = idle
const NO_MOVEMENT_REPEAT_MS = 15000;      // re-prompt at most once per 15 s

// Wrong-movement sanity gates (Tier 2 #7)
const MIN_REP_DURATION_MS = 300;          // rejects jump-and-stand-up as a rep
const MAX_HIP_VELOCITY = 1.5;             // normalized units / sec, peak descent
const MIN_BILATERAL_SYMMETRY = 0.7;       // min(L,R) / max(L,R) at peak ≥ this

// 2026-05-25: physical-test fix — reject reps where knees were valgus for too
// many frames. Debounced kneesValgus signal misses intermittent collapsing
// patterns ("just sit down with knees touching" passes through). This raw
// counter is debounce-free.
const MAX_VALGUS_FRAME_RATIO = 0.25;      // > 25% valgus frames = collapsed-knees

export class SquatEngine {
  private callbacks: SquatEngineCallbacks;
  private calibration: SquatCalibration;
  private baseline: CalibrationBaseline | null = null;

  private repState: RepState = 'STANDING';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { heelOKCount: 0, kneeOKCount: 0, trunkOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  // Per-rep wrong-movement tracking (Tier 2 #7)
  private repStartedAt = 0;                    // when STANDING → DESCENDING
  private repPeakLeftKneeDeg = 0;              // for bilateral symmetry check
  private repPeakRightKneeDeg = 0;

  // 2026-05-25: raw per-frame counters (debounce-free) for collapsed-knees +
  // post-rep summary stats. Reset in resetRepBuffers().
  private currentRepValgusFramesRaw = 0;
  private currentRepHeelLiftFramesRaw = 0;

  // No-movement detection (Tier 1 #2)
  private standingSince = 0;                   // when we last entered STANDING
  private standingFlexionMin = Infinity;       // min flexion seen while STANDING (this idle window)
  private standingFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  private heelLiftFrames = 0;
  private valgusFrames = 0;
  private facingBadFrames = 0;
  private distanceBadFrames = 0;
  private feetNarrowFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: SquatEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SquatCalibration();
  }

  /** Feed one pose frame. Engine internally routes to calibration vs tracking. */
  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed' && calUpdate.baseline) {
        this.baseline = calUpdate.baseline;
        // 2026-05-25 Engine bug A fix: initialize standingSince at the moment
        // calibration confirms. Without this, the engine starts at standingSince=0
        // and the first STANDING frame post-cal reports idleMs = (now - 0) =
        // millions, instantly firing 'not-moving'. Reset all idle-tracking state
        // here so the 8-second timeout starts from this exact moment.
        this.standingSince = now;
        this.standingFlexionMin = this.smoothedFlexion;
        this.standingFlexionMax = this.smoothedFlexion;
        debugLog('SQUAT', 'CALIB', 'CONFIRMED', {
          feetVsShoulderRatio: +calUpdate.baseline.feetVsShoulderRatio.toFixed(2),
          torsoHeight: +calUpdate.baseline.torsoHeight.toFixed(3),
        });
      }
      return;
    }

    if (!landmarks || !this.baseline) return;
    this.processTrackingFrame(landmarks, now);
  }

  /** Force-complete the engine (e.g., user stopped early). */
  finish(): void {
    this.finished = true;
  }

  /** Reset the rep state machine for the next set. Keeps calibration. */
  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableBottomCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];

    const coreOk = lmVisible(lh) && lmVisible(rh) && lmVisible(lk) && lmVisible(rk)
      && lmVisible(la) && lmVisible(ra) && lmVisible(ls) && lmVisible(rs);
    if (!coreOk) return;

    // Knee flexion (avg of L + R)
    const leftKnee = kneeFlexionDeg(lh, lk, la);
    const rightKnee = kneeFlexionDeg(rh, rk, ra);
    const rawFlexion = (leftKnee + rightKnee) / 2;
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_KNEE * rawFlexion + (1 - EMA_ALPHA_KNEE) * this.smoothedFlexion;

    // Trunk lean
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const trunkDeg = trunkLeanDeg(shoulderMid, hipMid);

    // Hip Y velocity (for smoothness)
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (hipMid.y - this.prevHipY) / dt;
        if (this.repState === 'DESCENDING' || this.repState === 'ASCENDING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = hipMid.y;
    this.prevHipTimestamp = now;

    // Posture gates (each tracks its own debounce)
    const heelLifted = this.detectHeelLift(landmarks, baseline);
    const kneesValgus = this.detectValgus(landmarks, baseline);
    const trunkBad = trunkDeg >= TRUNK_WARN_DEG;
    const feetTooNarrow = this.detectFeetNarrow(landmarks, baseline);
    const notFacing = this.detectNotFacing(landmarks, baseline);
    const { tooClose, tooFar } = this.detectDistance(landmarks, baseline);

    // Raw per-frame valgus / heel-lift checks (debounce-free) used for
    // collapsed-knees rep-rejection + post-rep summary logging.
    // detectValgus / detectHeelLift are called above and return DEBOUNCED state;
    // we re-derive the raw signal here from the same baseline math.
    const lkRaw = landmarks[LM.LEFT_KNEE];
    const rkRaw = landmarks[LM.RIGHT_KNEE];
    const kneeWidthNow = Math.abs(lkRaw.x - rkRaw.x);
    const baselineKneeWidth = Math.abs(baseline.leftKneeX - baseline.rightKneeX);
    const rawValgus = baselineKneeWidth > 0
      && (1 - kneeWidthNow / baselineKneeWidth) > VALGUS_THRESHOLD_RATIO;
    const laRaw = landmarks[LM.LEFT_ANKLE];
    const raRaw = landmarks[LM.RIGHT_ANKLE];
    const currentAnkleY = (laRaw.y + raRaw.y) / 2;
    const rawHeelLift = (baseline.ankleY - currentAnkleY) > HEEL_LIFT_THRESHOLD;

    // Form accumulation during DESCENDING/AT_BOTTOM/ASCENDING (active squat phase)
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!heelLifted) this.repFormCounts.heelOKCount++;
      if (!kneesValgus) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
      if (rawValgus) this.currentRepValgusFramesRaw++;
      if (rawHeelLift) this.currentRepHeelLiftFramesRaw++;
    }

    // Track warnings that hit during this rep (drives report's per-rep tags)
    if (heelLifted) this.repWarnings.add('heel-lift');
    if (kneesValgus) this.repWarnings.add('valgus');
    if (trunkBad) this.repWarnings.add('trunk-forward');
    if (feetTooNarrow) this.repWarnings.add('feet-narrow');
    if (notFacing) this.repWarnings.add('not-facing');
    if (tooClose) this.repWarnings.add('too-close');
    if (tooFar) this.repWarnings.add('too-far');

    // 2026-05-25 round 2: gate posture-form warnings to the active rep phase.
    // Heel/valgus/trunk/feet detection runs constantly (the per-frame raw
    // counters need it for the collapsed-knees check), but coaching the user
    // about "keep heels down" while they're just standing between reps is
    // noise — they're not even squatting. The previous round produced 11
    // heel-lift voices in a 27s pause; this gate kills that spam.
    // Tracking-validity warnings (not-facing, too-close, too-far, not-moving)
    // remain ungated — they affect whether the engine can read the user at all.
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.maybeEmitWarning('heel-lift', heelLifted, now);
      this.maybeEmitWarning('valgus', kneesValgus, now);
      this.maybeEmitWarning('trunk-forward', trunkBad, now);
      this.maybeEmitWarning('feet-narrow', feetTooNarrow, now);
    }
    this.maybeEmitWarning('not-facing', notFacing, now);
    this.maybeEmitWarning('too-close', tooClose, now);
    this.maybeEmitWarning('too-far', tooFar, now);

    // Per-rep bilateral knee peak (for symmetry sanity check)
    if (this.repState !== 'STANDING') {
      if (leftKnee > this.repPeakLeftKneeDeg) this.repPeakLeftKneeDeg = leftKnee;
      if (rightKnee > this.repPeakRightKneeDeg) this.repPeakRightKneeDeg = rightKnee;
    }

    // No-movement detection (Tier 1 #2)
    this.checkNoMovement(now);

    // State machine
    this.advanceRepState(now);

    // Per-frame snapshot for HUD
    const frameMetrics: FrameMetrics = {
      kneeFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      trunkLeanDeg: trunkDeg,
      heelLifted, kneesValgus,
      feetTooNarrow, notFacing, tooFar, tooClose,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedFlexion > DESCEND_START) {
          this.repState = 'DESCENDING';
          // 2026-05-25 round 2: must reset FIRST, then set repStartedAt.
          // resetRepBuffers() zeros repStartedAt — calling it AFTER the assignment
          // (as in round 1) immediately erased the timestamp, so every REP and
          // REJECT log reported durationMs: 0. Reorder fixes this for real.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('SQUAT', 'STATE', 'STANDING → DESCENDING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'DESCENDING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('SQUAT', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
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
          this.repState = 'ASCENDING';
          debugLog('SQUAT', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedFlexion < STANDING_THRESHOLD) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingFlexionMin = Infinity;
          this.standingFlexionMax = -Infinity;
        }
        break;
    }
  }

  /** Per-rep validation against wrong-movement sanity gates (Tier 2 #7). */
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 2026-05-25 round 2: check unilateral FIRST. The averaged-flexion
    // too-shallow check shadows it otherwise — if leftPeak=33°, rightPeak=105°,
    // the average ~70° gets smoothed to ~45° (below MIN_REP_DEPTH) and the
    // reject reason becomes "too-shallow" when the actual issue is asymmetry.
    const peakSum = this.repPeakLeftKneeDeg + this.repPeakRightKneeDeg;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftKneeDeg, this.repPeakRightKneeDeg);
      const hi = Math.max(this.repPeakLeftKneeDeg, this.repPeakRightKneeDeg);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }
    if (this.maxFlexionThisRep < MIN_REP_DEPTH) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    // 2026-05-25 Issue 1 fix: reject reps where knees were collapsed inward
    // for a meaningful fraction of the active frames. The debounced
    // kneesValgus signal can be intermittent (10-frame on / 5-frame off)
    // and miss "just sit down with knees touching" patterns. The raw
    // counter catches it.
    const activeFrames = this.repFormCounts.totalCount;
    if (activeFrames > 0 && this.currentRepValgusFramesRaw / activeFrames > MAX_VALGUS_FRAME_RATIO) {
      return { ok: false, reason: 'collapsed-knees' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    // Capture before any reset so REJECT/REP logs report the real duration.
    const durationMs = this.repStartedAt > 0 ? Math.round(now - this.repStartedAt) : 0;
    const totalFrames = this.repFormCounts.totalCount;
    const valgusFrames = this.currentRepValgusFramesRaw;
    const heelLiftFrames = this.currentRepHeelLiftFramesRaw;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      debugLog('SQUAT', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDepth: +this.maxFlexionThisRep.toFixed(1),
        durationMs,
        totalFrames,
        valgusFrames,
        heelLiftFrames,
        leftPeak: +this.repPeakLeftKneeDeg.toFixed(1),
        rightPeak: +this.repPeakRightKneeDeg.toFixed(1),
      });
      // Don't count — emit malformed-rep warning so user gets actionable feedback
      if (validation.reason !== 'too-shallow') {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }
    const smoothness = getSmoothnessScore(this.repHipVelocities);
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
    debugLog('SQUAT', 'REP', 'Rep complete', {
      ...repPayload,
      durationMs,
      totalFrames,
      valgusFrames,
      heelLiftFrames,
    });
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingFlexionMin = this.smoothedFlexion;
      this.standingFlexionMax = this.smoothedFlexion;
      return;
    }
    // Track flexion range while idle
    if (this.smoothedFlexion < this.standingFlexionMin) this.standingFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.standingFlexionMax) this.standingFlexionMax = this.smoothedFlexion;
    const idleMs = now - this.standingSince;
    const variance = this.standingFlexionMax - this.standingFlexionMin;
    // 2026-05-25: cold-start cooldown fix — `lastNoMovementWarnAt = 0` initially.
    // If the engine timestamp `now` is < NO_MOVEMENT_REPEAT_MS (15s) at first
    // potential fire, the cooldown check (now - 0 >= 15000) blocks it. In the
    // browser this is never an issue (performance.now() is large by then), but
    // in test harnesses where now starts at 0, the first fire is suppressed.
    // Treat the initial 0 sentinel as "never fired" and allow the first fire.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('SQUAT', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      // Reset the window so we re-arm cleanly for the next 12 s
      this.standingSince = now;
      this.standingFlexionMin = this.smoothedFlexion;
      this.standingFlexionMax = this.smoothedFlexion;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { heelOKCount: 0, kneeOKCount: 0, trunkOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftKneeDeg = 0;
    this.repPeakRightKneeDeg = 0;
    this.currentRepValgusFramesRaw = 0;
    this.currentRepHeelLiftFramesRaw = 0;
  }

  // ----------------------------------------------------------
  // Posture gates
  // ----------------------------------------------------------
  private detectHeelLift(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const currentAnkleY = (la.y + ra.y) / 2;
    // Heel lift = ankle moved UP (smaller y) vs baseline beyond threshold
    const lift = baseline.ankleY - currentAnkleY;
    const isLifted = lift > HEEL_LIFT_THRESHOLD;
    if (isLifted) {
      this.heelLiftFrames++;
    } else {
      this.heelLiftFrames = 0;
    }
    return this.heelLiftFrames >= HEEL_LIFT_DEBOUNCE_FRAMES;
  }

  private detectValgus(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const kneeWidth = Math.abs(lk.x - rk.x);
    const baselineKneeWidth = Math.abs(baseline.leftKneeX - baseline.rightKneeX);
    if (baselineKneeWidth === 0) return false;
    const collapseRatio = 1 - kneeWidth / baselineKneeWidth; // positive when knees moved in
    const isValgus = collapseRatio > VALGUS_THRESHOLD_RATIO;
    if (isValgus) {
      this.valgusFrames++;
    } else {
      this.valgusFrames = 0;
    }
    return this.valgusFrames >= VALGUS_DEBOUNCE_FRAMES;
  }

  private detectFeetNarrow(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const feetWidth = Math.abs(la.x - ra.x);
    const ratio = baseline.feetWidth > 0 ? feetWidth / baseline.feetWidth : 1;
    const isNarrow = ratio < FEET_WIDTH_MIN_RATIO;
    if (isNarrow) {
      this.feetNarrowFrames++;
    } else {
      this.feetNarrowFrames = 0;
    }
    return this.feetNarrowFrames >= 6;
  }

  private detectNotFacing(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const ratio = baseline.shoulderWidth > 0 ? shoulderWidth / baseline.shoulderWidth : 1;
    const notFacing = ratio < FACING_WIDTH_MIN_RATIO;
    if (notFacing) {
      this.facingBadFrames++;
    } else {
      this.facingBadFrames = 0;
    }
    return this.facingBadFrames >= FACING_WARN_FRAMES;
  }

  private detectDistance(
    landmarks: PoseLandmarks,
    baseline: CalibrationBaseline,
  ): { tooClose: boolean; tooFar: boolean } {
    const head = landmarks[LM.LEFT_SHOULDER];
    const foot = landmarks[LM.LEFT_ANKLE];
    if (!lmVisible(head) || !lmVisible(foot)) return { tooClose: false, tooFar: false };
    const bodyHeight = Math.abs(foot.y - head.y);
    const baseHeight = Math.abs(baseline.ankleY - baseline.shoulderMid.y);
    if (baseHeight === 0) return { tooClose: false, tooFar: false };
    const ratio = bodyHeight / baseHeight;
    let tooClose = false;
    let tooFar = false;
    if (bodyHeight < BODY_HEIGHT_MIN_RATIO) tooFar = true;
    else if (ratio > 1.35) tooClose = true;
    if (tooClose || tooFar) {
      this.distanceBadFrames++;
    } else {
      this.distanceBadFrames = 0;
    }
    const confirmed = this.distanceBadFrames >= DISTANCE_WARN_FRAMES;
    return { tooClose: confirmed && tooClose, tooFar: confirmed && tooFar };
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('SQUAT', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
