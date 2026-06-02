/**
 * PistolSquatEngine — rep-based tracker for front-camera Pistol Squat.
 *
 * Mirrors LungeEngine's 4-state machine and operates UNILATERALLY: at the
 * STANDING → DESCENDING transition, the engine picks the leg with the higher
 * knee flex as the "standing leg" for this rep and tracks only that leg's flex
 * for the duration of the rep. The floating leg is ignored by the state machine.
 *
 * State machine:
 *   STANDING (standing-leg flex ≤ 18°) → DESCENDING (standing-leg flex > 25°) →
 *   AT_BOTTOM (stable 8+ frames at low Δ) → ASCENDING (flex dropping by
 *   ASCENT_FROM_PEAK_DEG or 3°+ per frame) → STANDING (flex < 18°, rep done).
 *
 * Warnings:
 *   - `valgus`                  — standing knee caves toward midline (vs baseline knee width)
 *   - `trunk-lean`              — torso lean > 55°
 *   - `incomplete-pistol-squat` — peak standing-leg flex < MIN_REP_DEPTH_DEG on rep complete
 *   - `malformed-rep`           — ballistic / too-fast / too-short
 *   - `not-moving`              — 5s idle
 *   - `position-lost`           — 3s no valid landmarks post-cal
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, kneeFlexionDeg, trunkLeanDeg } from './geometry';
import { PistolSquatCalibration } from './calibration';
import type { PistolSquatBaseline, PistolSquatEngineCallbacks, PistolSquatFrameMetrics, PistolSquatRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.15;
const DESCENT_START_DEG = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;
const STANDING_THRESHOLD_DEG = 18;
const MIN_REP_DEPTH_DEG = 70;          // pistol must go deeper than a lunge

const VALGUS_THRESHOLD_RATIO = 0.20;   // knee X collapses 20%+ of baseline knee width
const VALGUS_DEBOUNCE_FRAMES = 10;
const TRUNK_WARN_DEG = 55;             // forward lean warning threshold

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// 2026-05-25 round 6: position-lost detection — fire if no usable pose frame
// for ≥ 3 s post-cal, repeat every 10 s while still lost.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
const MAX_HIP_VELOCITY = 1.5;
// BUG-PSQ-01 fix: when one ankle is this much higher than the other (normalised
// coords, Y increases downward), treat the LOWER ankle as the grounded/standing leg
// and ignore the raised ankle's knee flex for descent detection.
const ANKLE_LIFT_THRESHOLD = 0.04;
// Pistol squat is unilateral — the floating leg stays extended forward while the
// standing leg squats deep. We check that the standing leg's peak meaningfully
// exceeds the floating leg's peak, catching "no real pistol" reps.
const MIN_FRONT_BACK_GAP_DEG = 15;    // standing leg peak must exceed floating leg by this

export class PistolSquatEngine {
  private callbacks: PistolSquatEngineCallbacks;
  private calibration: PistolSquatCalibration;
  private baseline: PistolSquatBaseline | null = null;

  private repState: PistolSquatRepState = 'STANDING';
  private standingLeg: 'left' | 'right' | null = null;
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private maxFloatingLegFlexThisRep = 0;
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
  // BUG-PSQ-02 fix: set true when the rep is counted at AT_BOTTOM so the
  // ASCENDING → STANDING cleanup does not double-count.
  private repCountedAtBottom = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: PistolSquatEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new PistolSquatCalibration();
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
          debugLog('PISTOL-SQUAT', 'CALIB', 'CONFIRMED', {
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
    this.standingLeg = null;
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableBottomCount = 0;
    this.repCountedAtBottom = false;
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

    // While STANDING we detect descent onset using ankle height to identify the
    // grounded leg. In normalised coordinates Y increases downward, so a higher
    // Y value means the ankle is lower (on the floor). When the user lifts the
    // floating knee (bending it before extending it forward), Math.max would
    // incorrectly fire DESCENDING on the floating leg. Instead, if one ankle is
    // clearly off the floor (diff > ANKLE_LIFT_THRESHOLD), use only the grounded
    // leg's flex for onset detection. When both ankles are at similar height
    // (both feet on the floor, pre-lift), fall back to Math.max as before.
    // BUG-PSQ-01 fix.
    const ankleDiff = Math.abs(la.y - ra.y);
    const groundedIsLeft = la.y >= ra.y; // larger Y = lower = on floor
    const standingLegFlex = this.standingLeg === 'left' ? leftKnee
      : this.standingLeg === 'right' ? rightKnee
      : ankleDiff > ANKLE_LIFT_THRESHOLD
        ? (groundedIsLeft ? leftKnee : rightKnee)
        : Math.max(leftKnee, rightKnee);
    const floatingLegFlex = this.standingLeg === 'left' ? rightKnee
      : this.standingLeg === 'right' ? leftKnee
      : ankleDiff > ANKLE_LIFT_THRESHOLD
        ? (groundedIsLeft ? rightKnee : leftKnee)
        : Math.min(leftKnee, rightKnee);

    const rawFlexion = standingLegFlex;
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

    // Valgus on the standing leg only. Pass the raw standing leg flex so the
    // detection uses actual (not EMA-lagged) flex for expected outreach calculation.
    const valgusStanding = this.detectStandingKneeValgus(landmarks, baseline, standingLegFlex);
    const trunkBad = trunkDeg >= TRUNK_WARN_DEG;

    // Form accumulation
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!valgusStanding) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
      // knee-past-toe is disabled from front camera; assume OK each frame
      // so the score component reflects a 100% pass rate (since we can't
      // observe failures).
      this.repFormCounts.kneeOverToeOKCount++;
    }

    if (valgusStanding) this.repWarnings.add('valgus');
    if (trunkBad) this.repWarnings.add('trunk-lean');

    // 2026-05-25 round 5 (Fix A): gate form coaching to active rep phase.
    // Standing between reps with mild knee cave or trunk lean shouldn't spam
    // warnings — the user isn't squatting at the moment, they're resting.
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.maybeEmitWarning('valgus', valgusStanding, now);
      this.maybeEmitWarning('trunk-lean', trunkBad, now);
    }

    // Track floating-leg peak for the gap check
    if (this.repState !== 'STANDING' && floatingLegFlex > this.maxFloatingLegFlexThisRep) {
      this.maxFloatingLegFlexThisRep = floatingLegFlex;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now, leftKnee, rightKnee, la.y, ra.y);

    const frameMetrics: PistolSquatFrameMetrics = {
      kneeFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      standingLeg: this.standingLeg,
      repState: this.repState,
      trunkLeanDeg: trunkDeg,
      valgusStanding,
      trunkBad,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number, leftKnee: number, rightKnee: number, leftAnkleY: number, rightAnkleY: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedFlexion > DESCENT_START_DEG) {
          // Lock the standing leg: use ankle height to identify the grounded leg.
          // If one ankle is clearly off the floor, that leg is the floating leg —
          // the OTHER ankle must be the standing leg. This prevents the floating-knee
          // lift (user preparing for pistol) from being misidentified as the
          // descending leg. BUG-PSQ-01 fix.
          const ankDiff = Math.abs(leftAnkleY - rightAnkleY);
          if (ankDiff > ANKLE_LIFT_THRESHOLD) {
            // Higher Y in normalised coords = lower position = on the floor.
            this.standingLeg = leftAnkleY >= rightAnkleY ? 'left' : 'right';
          } else {
            // Both feet on floor: the leg bending more is the standing leg.
            this.standingLeg = leftKnee >= rightKnee ? 'left' : 'right';
          }
          this.repState = 'DESCENDING';
          // Must reset FIRST, then set repStartedAt (existing Fix C comment preserved).
          this.resetRepBuffers();
          this.repCountedAtBottom = false;
          this.repStartedAt = now;
          debugLog('PISTOL-SQUAT', 'STATE', 'STANDING → DESCENDING', {
            standingLeg: this.standingLeg,
            leftFlex: +leftKnee.toFixed(1),
            rightFlex: +rightKnee.toFixed(1),
            ankDiff: +ankDiff.toFixed(3),
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
            debugLog('PISTOL-SQUAT', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        // BUG-PSQ-02 fix: count the rep the first time depth is confirmed in AT_BOTTOM,
        // not at ASCENDING → STANDING. AT_BOTTOM fires early during a smooth EMA descent
        // (~43° smoothed for a 90° target), so we wait until maxFlexionThisRep reaches
        // actual depth before counting. The ASCENDING → STANDING path is the fallback
        // for shallow reps (maxFlexionThisRep never reaches MIN_REP_DEPTH_DEG).
        if (!this.repCountedAtBottom && this.maxFlexionThisRep >= MIN_REP_DEPTH_DEG) {
          this.completeRep(now);
          this.repCountedAtBottom = true;
        }
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        // After completeRep resets maxFlexionThisRep to 0, dropFromPeak goes negative
        // so the ascent transition is driven solely by deltaDown < -ASCENDING_DELTA_MIN.
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -ASCENDING_DELTA_MIN || dropFromPeak >= ASCENT_FROM_PEAK_DEG) {
          this.repState = 'ASCENDING';
          debugLog('PISTOL-SQUAT', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedFlexion < STANDING_THRESHOLD_DEG) {
          if (!this.repCountedAtBottom) {
            // Fallback: rep was not counted at AT_BOTTOM (edge case — e.g. AT_BOTTOM
            // was skipped due to EMA lag). Count it now to avoid losing the rep.
            debugLog('PISTOL-SQUAT', 'STATE', 'ASCENDING → STANDING (fallback count)', {
              peak: +this.maxFlexionThisRep.toFixed(1),
            });
            this.completeRep(now);
          } else {
            // Normal path: rep already counted at AT_BOTTOM. Just reset buffers
            // so the next rep starts clean. Do NOT call completeRep again.
            this.resetRepBuffers();
          }
          this.repCountedAtBottom = false;
          this.repState = 'STANDING';
          this.standingLeg = null;
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
    // Fix D: Unilateral check BEFORE too-shallow (gap check before depth check)
    const gap = this.maxFlexionThisRep - this.maxFloatingLegFlexThisRep;
    if (gap < MIN_FRONT_BACK_GAP_DEG) {
      return { ok: false, reason: 'bilateral-squat' };
    }
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
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('PISTOL-SQUAT', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakStanding: +this.maxFlexionThisRep.toFixed(1),
        peakFloating: +this.maxFloatingLegFlexThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        standingLeg: this.standingLeg,
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-pistol-squat', true, now);
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
      standingLeg: this.standingLeg ?? 'left' as const,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('PISTOL-SQUAT', 'REP', 'Rep complete', repPayload);
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
      debugLog('PISTOL-SQUAT', 'WARN', 'not-moving', {
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
    this.maxFloatingLegFlexThisRep = 0;
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
  private detectStandingKneeValgus(
    landmarks: PoseLandmarks,
    baseline: PistolSquatBaseline,
    rawStandingFlex: number,
  ): boolean {
    void rawStandingFlex; // not used in current detection approach
    if (this.standingLeg === null) return false;
    const ankle = landmarks[this.standingLeg === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    const knee = landmarks[this.standingLeg === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    void baseline;

    // Valgus detection: the standing knee has caved INWARD past the ankle's
    // lateral position. In a proper pistol squat, the knee should track outward
    // of the foot; if it crosses inward of the ankle, that's valgus.
    //
    // We use a direct position check: is the standing knee within a tolerance
    // of the ankle X (or past it toward midline)?
    // For LEFT leg: valgus = knee.x > ankle.x - TOLERANCE
    //   (knee has moved rightward to near/past ankle's right edge)
    // For RIGHT leg: valgus = knee.x < ankle.x + TOLERANCE
    //   (knee has moved leftward to near/past ankle's left edge)
    //
    // Tolerance = half of baseline knee width × VALGUS_THRESHOLD_RATIO
    // = approx 0.013 (small enough to only fire for genuine valgus).
    // The pose-stub places the valgus knee INWARD of the ankle (knee.x > ankle.x
    // for left), which clearly satisfies this condition.
    const baselineKneeHalf = Math.abs(baseline.leftKneeX - baseline.rightKneeX) / 2;
    const tolerance = baselineKneeHalf * VALGUS_THRESHOLD_RATIO;
    const isValgus = this.standingLeg === 'left'
      ? knee.x > ankle.x - tolerance   // left knee caved rightward near/past ankle
      : knee.x < ankle.x + tolerance;  // right knee caved leftward near/past ankle

    // The `standingLeg !== null` guard at the top of this method plus Fix A's
    // `inActiveRep` gate (caller only invokes maybeEmitWarning when repState != STANDING)
    // together prevent false positives. No additional flex-depth guard needed here.

    if (isValgus) {
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
    debugLog('PISTOL-SQUAT', 'WARN', type);
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
    debugLog('PISTOL-SQUAT', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
