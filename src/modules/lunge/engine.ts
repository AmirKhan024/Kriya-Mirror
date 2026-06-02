/**
 * LungeEngine — rep-based tracker for front-camera Forward Lunge.
 *
 * Mirrors SquatEngine's 4-state machine but operates UNILATERALLY: at the
 * STANDING → DESCENDING transition, the engine picks the leg with the higher
 * knee flex as the "front leg" for this rep and tracks only that leg's flex
 * for the duration of the rep. The back leg is ignored by the state machine.
 *
 * State machine:
 *   STANDING (front-leg flex ≤ 18°) → DESCENDING (front-leg flex > 25°) →
 *   AT_BOTTOM (stable 8+ frames at low Δ) → ASCENDING (flex dropping by
 *   ASCENT_FROM_PEAK_DEG or 3°+ per frame) → STANDING (flex < 18°, rep done).
 *
 * Warnings:
 *   - `valgus`           — front knee caves toward midline (vs baseline knee width)
 *   - `trunk-forward`    — torso lean > 55°
 *   - `incomplete-lunge` — peak front-leg flex < MIN_REP_DEPTH on rep complete
 *   - `malformed-rep`    — ballistic / unilateral-imposter / too-fast
 *   - `not-moving`       — 12s idle
 *   - `too-close` / `too-far` — calibration emits, engine forwards
 *   - `knee-past-toe`    — DISABLED from front-camera; the warning type exists
 *                          for a future side-camera variant where knee.x vs
 *                          foot.x can be measured in the sagittal plane.
 *                          (See .context/03_KNOWN_ISSUES_TO_PREVENT.md.)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, kneeFlexionDeg, trunkLeanDeg } from './geometry';
import { LungeCalibration } from './calibration';
import type { LungeBaseline, LungeEngineCallbacks, LungeFrameMetrics, LungeRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.15;
const DESCEND_START_DEG = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;
const STANDING_THRESHOLD_DEG = 18;
// MIN_REP_DEPTH 50° (not 60°): with EMA(α=0.15) the smoothed peak is ~55% of
// raw at short cycles. 50° lets ballistic reps pass the shallow gate so the
// ballistic-velocity gate trips for accurate "slow down" feedback. Same
// reasoning as push-up's MIN_REP_DEPTH_DEG — see B10 in known-issues.
const MIN_REP_DEPTH_DEG = 50;

const VALGUS_THRESHOLD_RATIO = 0.20;     // front knee X collapsed by 20%+ vs baseline knee width
const VALGUS_DEBOUNCE_FRAMES = 10;
const TRUNK_WARN_DEG = 55;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 5 (§3.7): 5s idle warning (was 12s). Mirrors squat's spec.
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// 2026-05-25 round 6: position-lost detection — fire if no usable pose frame
// for ≥ 3 s post-cal, repeat every 10 s while still lost.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
const MAX_HIP_VELOCITY = 1.5;
// Lunge is unilateral by design — back leg stays straight, front leg flexes
// — so we don't enforce bilateral symmetry per rep (squat's 0.7 ratio would
// reject every valid lunge). We still check that the front leg's peak is
// meaningfully larger than the back leg's, which catches "no real lunge"
// reps (both legs barely flex at all).
const MIN_FRONT_BACK_GAP_DEG = 20;        // front-leg peak must exceed back-leg peak by this

export class LungeEngine {
  private callbacks: LungeEngineCallbacks;
  private calibration: LungeCalibration;
  private baseline: LungeBaseline | null = null;

  private repState: LungeRepState = 'STANDING';
  private frontLeg: 'left' | 'right' | null = null;
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private maxBackLegFlexThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, kneeOverToeOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection
  private standingSince = 0;
  private standingFlexionMin = Infinity;
  private standingFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // 2026-05-25 round 7: post-rep EMA-decay reseed. Without this, the
  // smoothedFlexion decay tail after a rep (~17° → 0° over several seconds)
  // permanently inflates `max - min`, so `variance` never drops below 2°
  // and `not-moving` never fires after the user does a rep and then rests.
  // We re-baseline min/max once smoothedFlexion has settled (per-frame delta
  // < 0.3° for 500ms straight).
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // 2026-05-25 round 6: position-lost detection (tracking-validity heartbeat)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private valgusFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: LungeEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new LungeCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // 2026-05-25 round 5 (§3.7): initialize standingSince + idle tracking
        // on cal-confirm. Without this the construction-time-0 value causes
        // an instant false-positive 'not-moving' on the first post-cal frame.
        this.standingSince = now;
        this.standingFlexionMin = this.smoothedFlexion;
        this.standingFlexionMax = this.smoothedFlexion;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // 2026-05-25 round 6: seed position-lost heartbeat too.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('LUNGE', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            feetWidth: +this.baseline.feetWidth.toFixed(3),
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
    this.repState = 'STANDING';
    this.frontLeg = null;
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

    // Both legs' flex
    const leftKnee = kneeFlexionDeg(lh, lk, la);
    const rightKnee = kneeFlexionDeg(rh, rk, ra);

    // While STANDING we use the MAX of the two legs to detect the next rep's
    // onset (whichever leg starts bending becomes the front leg). Once locked
    // into a rep, we track only the front leg's flex.
    const frontLegFlex = this.frontLeg === 'left' ? leftKnee
      : this.frontLeg === 'right' ? rightKnee
      : Math.max(leftKnee, rightKnee);
    const backLegFlex = this.frontLeg === 'left' ? rightKnee
      : this.frontLeg === 'right' ? leftKnee
      : Math.min(leftKnee, rightKnee);

    const rawFlexion = frontLegFlex;
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_KNEE * rawFlexion + (1 - EMA_ALPHA_KNEE) * this.smoothedFlexion;

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const trunkDeg = trunkLeanDeg(shoulderMid, hipMid);

    // Hip-Y velocity for smoothness (same as squat)
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

    // Valgus on the front leg only.
    const valgusFront = this.detectFrontKneeValgus(landmarks, baseline);
    const trunkBad = trunkDeg >= TRUNK_WARN_DEG;

    // Form accumulation
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!valgusFront) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
      // knee-past-toe is disabled from front camera; assume OK each frame
      // so the score component reflects a 100% pass rate (since we can't
      // observe failures).
      this.repFormCounts.kneeOverToeOKCount++;
    }

    if (valgusFront) this.repWarnings.add('valgus');
    if (trunkBad) this.repWarnings.add('trunk-forward');

    // 2026-05-25 round 5 (Fix A): gate form coaching to active rep phase.
    // Standing between reps with mild knee cave or trunk lean shouldn't spam
    // warnings — the user isn't lunging at the moment, they're resting.
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.maybeEmitWarning('valgus', valgusFront, now);
      this.maybeEmitWarning('trunk-forward', trunkBad, now);
    }

    // Track back-leg peak for the gap check
    if (this.repState !== 'STANDING' && backLegFlex > this.maxBackLegFlexThisRep) {
      this.maxBackLegFlexThisRep = backLegFlex;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now, leftKnee, rightKnee);

    const frameMetrics: LungeFrameMetrics = {
      kneeFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      frontLeg: this.frontLeg,
      repState: this.repState,
      trunkLeanDeg: trunkDeg,
      valgusFront,
      trunkBad,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number, leftKnee: number, rightKnee: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedFlexion > DESCEND_START_DEG) {
          // Lock the front leg for this rep — whichever raw-flex is higher.
          this.frontLeg = leftKnee >= rightKnee ? 'left' : 'right';
          this.repState = 'DESCENDING';
          // 2026-05-25 round 5 (Fix C): must reset FIRST, then set
          // repStartedAt. resetRepBuffers() zeros repStartedAt — calling it
          // AFTER the assignment immediately erased the timestamp, so every
          // REP and REJECT log reported durationMs: 0.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('LUNGE', 'STATE', 'STANDING → DESCENDING', {
            frontLeg: this.frontLeg,
            leftFlex: +leftKnee.toFixed(1),
            rightFlex: +rightKnee.toFixed(1),
          });
        }
        break;

      case 'DESCENDING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('LUNGE', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
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
          debugLog('LUNGE', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedFlexion < STANDING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.frontLeg = null;
          this.standingSince = now;
          this.standingFlexionMin = Infinity;
          this.standingFlexionMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.maxFlexionThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    // Front-back gap: front leg must have flexed meaningfully more than back leg.
    // If both legs flexed equally, the user squatted instead of lunging.
    const gap = this.maxFlexionThisRep - this.maxBackLegFlexThisRep;
    if (gap < MIN_FRONT_BACK_GAP_DEG) {
      return { ok: false, reason: 'bilateral-squat' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('LUNGE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakFront: +this.maxFlexionThisRep.toFixed(1),
        peakBack: +this.maxBackLegFlexThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        frontLeg: this.frontLeg,
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-lunge', true, now);
      } else {
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
      frontLeg: this.frontLeg ?? 'left',
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('LUNGE', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingFlexionMin = this.smoothedFlexion;
      this.standingFlexionMax = this.smoothedFlexion;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.standingFlexionMin) this.standingFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.standingFlexionMax) this.standingFlexionMax = this.smoothedFlexion;
    // 2026-05-25 round 7: re-baseline once the EMA has settled, so the
    // post-rep decay tail (smoothedFlexion drifting from ~17° → 0°) doesn't
    // permanently inflate `max - min`. Once per-frame change has been under
    // 0.3° for 500ms straight, drop the cached min/max and reseed from the
    // current value. Idle counting effectively starts from the settled point.
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingFlexionMin = this.smoothedFlexion;
          this.standingFlexionMax = this.smoothedFlexion;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }
    const idleMs = now - this.standingSince;
    const variance = this.standingFlexionMax - this.standingFlexionMin;
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
      debugLog('LUNGE', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingFlexionMin = this.smoothedFlexion;
      this.standingFlexionMax = this.smoothedFlexion;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.maxBackLegFlexThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, kneeOverToeOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.valgusFrames = 0;
  }

  // ----------------------------------------------------------
  // Posture gates
  // ----------------------------------------------------------
  private detectFrontKneeValgus(landmarks: PoseLandmarks, baseline: LungeBaseline): boolean {
    if (this.frontLeg === null) return false;
    const ankle = landmarks[this.frontLeg === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    const knee = landmarks[this.frontLeg === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    // Distance between front knee and front ankle, normalized by baseline
    // knee width (the natural width at calibration). If the front knee
    // has drifted INWARD past the ankle (toward body midline), that's valgus.
    const midlineX = (baseline.leftKneeX + baseline.rightKneeX) / 2;
    // Signed distance from midline — positive = on the same side as calibration,
    // negative = crossed past midline. We measure how much the knee has
    // collapsed toward the midline relative to ankle.
    const sign = this.frontLeg === 'left' ? -1 : 1;   // left knee normally at negative offset
    const baselineKneeX = this.frontLeg === 'left' ? baseline.leftKneeX : baseline.rightKneeX;
    const baselineOffset = (baselineKneeX - midlineX) * sign;   // positive natural width
    const currentOffset = (knee.x - midlineX) * sign;
    if (baselineOffset <= 0) return false;
    const collapseRatio = 1 - currentOffset / baselineOffset;   // 0 = no collapse, 1 = at midline
    const isValgus = collapseRatio > VALGUS_THRESHOLD_RATIO;

    // Also: knee crossed past ankle's lateral line (knee.x past ankle.x toward midline)
    const ankleOffset = (ankle.x - midlineX) * sign;
    const kneeInsideAnkle = currentOffset < ankleOffset - 0.02;

    if (isValgus || kneeInsideAnkle) {
      this.valgusFrames++;
    } else {
      this.valgusFrames = 0;
    }
    return this.valgusFrames >= VALGUS_DEBOUNCE_FRAMES;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('LUNGE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // 2026-05-25 round 6: position-lost detection
  // ----------------------------------------------------------

  /** Mirrors the coreOk check inside processTrackingFrame so the position-lost
   *  detection uses the same definition of "usable frame". */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE])
      && lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER]);
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
    debugLog('LUNGE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
