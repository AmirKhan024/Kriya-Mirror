/**
 * HighKneesEngine — front-camera, rep-based, ALTERNATING per-side reps.
 *
 * Per-side tracking: each knee has its own EMA-smoothed lift scalar (% of
 * shoulder width), computed against the per-side baseline knee Y. The state
 * machine is 3-state: BOTH_DOWN (rest) ↔ LEFT_UP ↔ RIGHT_UP. Reps are counted
 * on EXIT from any UP state — when the user transitions to the OTHER up state
 * (the immediate "next step" case during a continuous sequence), the current
 * rep finalizes and the next side's rep tracking begins on the same frame.
 *
 * State transitions:
 *   BOTH_DOWN → LEFT_UP   : smoothedLeft > HIGH AND smoothedRight < LOW
 *   BOTH_DOWN → RIGHT_UP  : mirrored
 *   LEFT_UP   → RIGHT_UP  : smoothedLeft < LOW AND smoothedRight > HIGH
 *                           (finalizes the LEFT_UP rep, starts RIGHT_UP rep)
 *   RIGHT_UP  → LEFT_UP   : mirrored
 *   LEFT_UP   → BOTH_DOWN : both smoothed lifts < LOW
 *   RIGHT_UP  → BOTH_DOWN : mirrored
 *
 * Hysteresis: LOW=10 vs HIGH=25 prevents chatter when one knee briefly crosses
 * the threshold during the rapid alternation.
 *
 * Posture warnings:
 *   - `torso-swing`    — shoulder-mid X drifts > 0.04 (gated to non-BOTH_DOWN)
 *   - `low-knee-lift`  — rep complete but peak lift < MIN_REP_HEIGHT_PCT
 *   - `malformed-rep`  — too-fast (< 150 ms) or ballistic (> 8.0 nu/sec)
 *   - `not-moving`     — 5 s idle in BOTH_DOWN
 *   - `position-lost`  — no usable pose frame for ≥ 3 s post-cal
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, MIN_SHOULDER_WIDTH_RUNTIME, kneeLiftPctFromKnee, clampKneeDelta } from './geometry';
import { HighKneesCalibration } from './calibration';
import type {
  HighKneesBaseline, HighKneesEngineCallbacks, HighKneesFrameMetrics, HighKneesRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.30;

// State-machine thresholds (% of shoulder width). Hysteresis gap = 10.
// 2026-05-28 round 22: LOW_THRESHOLD_PCT raised 10 → 15. The descent "knee is
// back down" gate fires when the knee is at 15% (~mid-thigh return) instead
// of 10% (knee fully reset). Trims ~150-200 ms of perceived rep-counter
// latency. Still unambiguously descending — no half-rep miscount risk.
const HIGH_THRESHOLD_PCT = 25;
const LOW_THRESHOLD_PCT = 15;
// 2026-05-28 round 23: raised 30 → 50. The previous threshold allowed "slight
// lift" reps (knee barely off the floor, 37-46% of shoulder width) to count
// in physical tests. 50% ≈ knee at mid-thigh — a clear intentional lift. Real
// high-knees cadence still hits 70-120% so this only filters the obvious
// barely-lifted reps the user complained about.
const MIN_REP_HEIGHT_PCT = 50;
// 2026-05-28 round 22: post-cal grace period. Console logs showed a ghost
// first rep firing ~1 s after cal-confirm before the user lifted. EMA seeds at
// the per-side baseline knee Y but noisy first frames can momentarily push the
// raw lift past HIGH=25 → state transitions to LEFT_UP/RIGHT_UP and a rep
// completes at the noise dies down. 500 ms gives the EMA + per-frame clamp
// time to converge before reps can be emitted.
const MIN_TIME_AFTER_CAL_MS = 500;
// 2026-05-28 round 21: cap raw per-rep peak. Physical tests showed MediaPipe
// knee landmark spikes to 335% / 365% (knee briefly mis-localized at the
// shoulder/face during fast motion). Without clamping, these outliers were
// counted as valid peaks → ghost reps with absurd depthDeg values reported.
// 120% ≈ knee at hip-to-shoulder level, the anatomical max for a real lift.
const MAX_REASONABLE_KNEE_LIFT_PCT = 120;

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle (Fix I + Fix O + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_PCT = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_PCT = 0.5;
const SETTLED_HOLD_MS = 500;

// Position-lost (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Rep shape (Fix D order: too-shallow → too-fast → ballistic)
const MIN_REP_DURATION_MS = 150;     // FAST cadence — high knees typically 200-300 ms per side
const MAX_KNEE_Y_VELOCITY = 8.0;     // Fix R — same range as jumping-jacks ballistic threshold

export class HighKneesEngine {
  private callbacks: HighKneesEngineCallbacks;
  private calibration: HighKneesCalibration;
  private baseline: HighKneesBaseline | null = null;

  private repState: HighKneesRepState = 'BOTH_DOWN';

  // Per-side EMA-smoothed knee Y. Seeded on first post-cal frame from baseline.
  private smoothedLeftKneeY = 0;
  private smoothedRightKneeY = 0;
  private kneeYSeeded = false;

  // Per-side smoothed lift (derived from smoothed knee Y - baseline) and the
  // previous-frame value for EMA-decay-tail tracking.
  private smoothedLeftLift = 0;
  private smoothedRightLift = 0;
  private prevSmoothedLeftLift = 0;
  private prevSmoothedRightLift = 0;

  // Active rep tracking (one rep at a time — when an UP state finalizes, its
  // rep is consumed and the next UP state starts a fresh rep).
  private currentRepSide: 'left' | 'right' | null = null;
  private currentRepPeak = 0;
  private currentRepStartedAt = 0;
  private currentRepKneeVelocities: number[] = [];
  private currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
  private currentRepWarnings: Set<WarningType> = new Set();
  private prevActiveKneeY = 0;
  private prevSampleTimestamp = 0;

  // Idle detection (BOTH_DOWN state). Tracks variance of max(left, right) lift.
  private bothDownSince = 0;
  private bothDownMaxLiftMin = Infinity;
  private bothDownMaxLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O — post-rep EMA-decay reseed flags.
  private bothDownSettledSince = 0;
  private bothDownBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // 2026-05-28 round 22: post-cal grace timestamp (ghost-rep prevention).
  private calConfirmedAt = 0;

  // Posture debounce
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: HighKneesEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new HighKneesCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          // Seed smoothed knee Ys from per-side baseline.
          this.smoothedLeftKneeY = this.baseline.baselineLeftKneeY;
          this.smoothedRightKneeY = this.baseline.baselineRightKneeY;
          this.kneeYSeeded = true;
          this.smoothedLeftLift = 0;
          this.smoothedRightLift = 0;
          this.prevSmoothedLeftLift = 0;
          this.prevSmoothedRightLift = 0;
          // Fix I + P: init idle tracking on cal-confirm.
          this.bothDownSince = now;
          this.bothDownMaxLiftMin = 0;
          this.bothDownMaxLiftMax = 0;
          this.lastValidFrameAt = now;
          // 2026-05-28 round 22: post-cal grace timestamp for ghost-rep prevention.
          this.calConfirmedAt = now;
          debugLog('KNEES', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            leftKneeY: +this.baseline.baselineLeftKneeY.toFixed(3),
            rightKneeY: +this.baseline.baselineRightKneeY.toFixed(3),
          });
        }
      }
      return;
    }

    // Position-lost runs regardless of usable frames.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'BOTH_DOWN';
    this.smoothedLeftLift = 0;
    this.smoothedRightLift = 0;
    this.prevSmoothedLeftLift = 0;
    this.prevSmoothedRightLift = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lk) && lmVisible(rk);
    if (!coreOk) return;

    // Per-frame raw knee Y, clamped against previous smoothed (heel_rise_hold).
    const clampedLeftY = this.kneeYSeeded ? clampKneeDelta(lk.y, this.smoothedLeftKneeY) : lk.y;
    const clampedRightY = this.kneeYSeeded ? clampKneeDelta(rk.y, this.smoothedRightKneeY) : rk.y;

    this.smoothedLeftKneeY = this.kneeYSeeded
      ? EMA_ALPHA_KNEE * clampedLeftY + (1 - EMA_ALPHA_KNEE) * this.smoothedLeftKneeY
      : clampedLeftY;
    this.smoothedRightKneeY = this.kneeYSeeded
      ? EMA_ALPHA_KNEE * clampedRightY + (1 - EMA_ALPHA_KNEE) * this.smoothedRightKneeY
      : clampedRightY;
    this.kneeYSeeded = true;

    // Per-side lift % (raw, against per-side baseline).
    const leftKneeLiftPct = kneeLiftPctFromKnee(lk.y, baseline.baselineLeftKneeY, baseline.shoulderWidth);
    const rightKneeLiftPct = kneeLiftPctFromKnee(rk.y, baseline.baselineRightKneeY, baseline.shoulderWidth);

    // Per-side smoothed lift — derived from smoothed knee Y.
    this.prevSmoothedLeftLift = this.smoothedLeftLift;
    this.prevSmoothedRightLift = this.smoothedRightLift;
    this.smoothedLeftLift = kneeLiftPctFromKnee(this.smoothedLeftKneeY, baseline.baselineLeftKneeY, baseline.shoulderWidth);
    this.smoothedRightLift = kneeLiftPctFromKnee(this.smoothedRightKneeY, baseline.baselineRightKneeY, baseline.shoulderWidth);

    // Velocity sampling — track per-frame Y velocity of the ACTIVE side.
    if (this.prevSampleTimestamp > 0 && this.currentRepSide !== null) {
      const dt = (now - this.prevSampleTimestamp) / 1000;
      if (dt > 0) {
        const activeKneeY = this.currentRepSide === 'left' ? lk.y : rk.y;
        const v = (activeKneeY - this.prevActiveKneeY) / dt;
        this.currentRepKneeVelocities.push(v);
      }
    }
    // Track prevActiveKneeY for next frame's velocity sample.
    if (this.currentRepSide !== null) {
      this.prevActiveKneeY = this.currentRepSide === 'left' ? lk.y : rk.y;
    }
    this.prevSampleTimestamp = now;

    // Torso swing — shoulder-mid X drift from baseline.
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Form accumulation during active phases.
    if (this.repState !== 'BOTH_DOWN') {
      this.currentRepFormCounts.totalCount++;
      if (!torsoSwingWarn) this.currentRepFormCounts.torsoOKCount++;
    }

    if (torsoSwingWarn) this.currentRepWarnings.add('torso-swing');

    // 2026-05-28 round 21: torso-swing CHIP/SPEECH emission DISABLED for
    // high-knees (mirror lateral-raise round 20 / calf-raise round 21).
    // Natural high-knee cadence shifts the shoulder mid X laterally as the
    // body counter-balances rapid knee lifts. Form-score still tracks the
    // shoulder drift (repFormCounts.torsoOKCount above) so MQS is penalised.

    // Update per-rep peak for the active side. Uses RAW lift (not smoothed)
    // so EMA lag doesn't shave the validated peak — same pattern as
    // calf-raise / jumping-jacks. The smoothed signal drives the state
    // machine; the raw signal drives rep validation.
    //
    // 2026-05-28 round 21: CLAMP the raw peak to MAX_REASONABLE_KNEE_LIFT_PCT.
    // Physical-test logs showed MediaPipe knee landmark spikes to 335% / 365%
    // during fast motion (single-frame outliers when knee is briefly
    // mis-localized). Without clamping these became ghost-reps with absurd
    // depthDeg values. Clamping caps the peak at a physically reasonable
    // value (knee at hip-to-shoulder level ≈ 120%) — real lifts still
    // count, outliers cap at the realistic max.
    if (this.currentRepSide === 'left') {
      const clamped = Math.min(leftKneeLiftPct, MAX_REASONABLE_KNEE_LIFT_PCT);
      if (clamped > this.currentRepPeak) this.currentRepPeak = clamped;
    } else if (this.currentRepSide === 'right') {
      const clamped = Math.min(rightKneeLiftPct, MAX_REASONABLE_KNEE_LIFT_PCT);
      if (clamped > this.currentRepPeak) this.currentRepPeak = clamped;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: HighKneesFrameMetrics = {
      leftKneeLiftPct,
      rightKneeLiftPct,
      smoothedLeftLift: this.smoothedLeftLift,
      smoothedRightLift: this.smoothedRightLift,
      repState: this.repState,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    const sL = this.smoothedLeftLift;
    const sR = this.smoothedRightLift;
    const leftUp = sL > HIGH_THRESHOLD_PCT;
    const leftDown = sL < LOW_THRESHOLD_PCT;
    const rightUp = sR > HIGH_THRESHOLD_PCT;
    const rightDown = sR < LOW_THRESHOLD_PCT;

    switch (this.repState) {
      case 'BOTH_DOWN': {
        // 2026-05-28 round 22: post-cal grace period. Suppress UP transitions
        // for MIN_TIME_AFTER_CAL_MS so noisy first-frame EMA seeds can't
        // trigger a ghost rep before the user has lifted.
        if (this.calConfirmedAt > 0 && now - this.calConfirmedAt < MIN_TIME_AFTER_CAL_MS) break;
        // Enter the UP state for whichever side rose first (HIGH threshold).
        // Tie-break: the side with the higher smoothed lift wins.
        if (leftUp && sL > sR) {
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('KNEES', 'STATE', 'BOTH_DOWN → LEFT_UP', { left: +sL.toFixed(2) });
        } else if (rightUp && sR > sL) {
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('KNEES', 'STATE', 'BOTH_DOWN → RIGHT_UP', { right: +sR.toFixed(2) });
        }
        break;
      }

      case 'LEFT_UP':
        // Cross-state transition: the OTHER side is now dominant (rising past
        // HIGH and taller than this side). We don't require the active side to
        // fall all the way to LOW — during continuous alternating high-knees
        // the cross-fade means both sides momentarily share elevation.
        if (rightUp && sR > sL) {
          this.completeRep(now);
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('KNEES', 'STATE', 'LEFT_UP → RIGHT_UP', { right: +sR.toFixed(2) });
        } else if (leftDown && rightDown) {
          // User stopped — finalize left rep, return to rest.
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('KNEES', 'STATE', 'LEFT_UP → BOTH_DOWN', {});
        }
        break;

      case 'RIGHT_UP':
        if (leftUp && sL > sR) {
          this.completeRep(now);
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('KNEES', 'STATE', 'RIGHT_UP → LEFT_UP', { left: +sL.toFixed(2) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('KNEES', 'STATE', 'RIGHT_UP → BOTH_DOWN', {});
        }
        break;
    }
  }

  private startRep(side: 'left' | 'right', now: number): void {
    // Fix C: reset BEFORE setting timestamp.
    this.resetRepBuffers();
    this.currentRepSide = side;
    this.currentRepStartedAt = now;
    // Seed prevActiveKneeY so first velocity sample is meaningful.
    this.prevActiveKneeY = side === 'left' ? this.smoothedLeftKneeY : this.smoothedRightKneeY;
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: too-shallow → too-fast → ballistic. No unilateral check (reps are
    // alternating-unilateral by design — enforced by the state machine).
    if (this.currentRepPeak < MIN_REP_HEIGHT_PCT) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.currentRepStartedAt > 0 && now - this.currentRepStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.currentRepKneeVelocities.length > 0) {
      const peakV = Math.max(...this.currentRepKneeVelocities.map(Math.abs));
      if (peakV > MAX_KNEE_Y_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    if (this.currentRepSide === null) return;
    const side = this.currentRepSide;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.currentRepStartedAt > 0 ? now - this.currentRepStartedAt : 0;
      debugLog('KNEES', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        side,
        peak: +this.currentRepPeak.toFixed(2),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('low-knee-lift', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.currentRepSide = null;
      return;
    }

    const smoothness = getSmoothnessScore(this.currentRepKneeVelocities);
    const form = getFormScore(this.currentRepFormCounts);
    const completion = getCompletionScore(this.currentRepPeak);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.currentRepPeak * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      side,
      warnings: Array.from(this.currentRepWarnings),
    };
    debugLog('KNEES', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.currentRepSide = null;
  }

  private resetBothDownTracking(now: number): void {
    this.bothDownSince = now;
    this.bothDownMaxLiftMin = Infinity;
    this.bothDownMaxLiftMax = -Infinity;
    this.bothDownSettledSince = 0;
    this.bothDownBaselineReseeded = false;
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'BOTH_DOWN') {
      this.bothDownSince = now;
      // Reset the variance accumulator to the current max-of-both lift so that
      // when we re-enter BOTH_DOWN the variance gate starts fresh.
      const maxLift = Math.max(this.smoothedLeftLift, this.smoothedRightLift);
      this.bothDownMaxLiftMin = maxLift;
      this.bothDownMaxLiftMax = maxLift;
      this.bothDownSettledSince = 0;
      this.bothDownBaselineReseeded = false;
      return;
    }
    const maxLift = Math.max(this.smoothedLeftLift, this.smoothedRightLift);
    if (maxLift < this.bothDownMaxLiftMin) this.bothDownMaxLiftMin = maxLift;
    if (maxLift > this.bothDownMaxLiftMax) this.bothDownMaxLiftMax = maxLift;
    // Fix O — post-rep EMA-decay reseed. Track the larger of the two per-side
    // EMA decay rates so the variance gate closes once BOTH sides have settled.
    if (!this.bothDownBaselineReseeded) {
      const leftDelta = Math.abs(this.smoothedLeftLift - this.prevSmoothedLeftLift);
      const rightDelta = Math.abs(this.smoothedRightLift - this.prevSmoothedRightLift);
      const maxDelta = Math.max(leftDelta, rightDelta);
      if (maxDelta < SETTLED_DELTA_PCT) {
        if (this.bothDownSettledSince === 0) this.bothDownSettledSince = now;
        if (now - this.bothDownSettledSince >= SETTLED_HOLD_MS) {
          this.bothDownMaxLiftMin = maxLift;
          this.bothDownMaxLiftMax = maxLift;
          this.bothDownSince = now;
          this.bothDownBaselineReseeded = true;
        }
      } else {
        this.bothDownSettledSince = 0;
      }
    }
    const idleMs = now - this.bothDownSince;
    const variance = this.bothDownMaxLiftMax - this.bothDownMaxLiftMin;
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_PCT
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('KNEES', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.bothDownSince = now;
      this.bothDownMaxLiftMin = maxLift;
      this.bothDownMaxLiftMax = maxLift;
      this.bothDownSettledSince = 0;
      this.bothDownBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.currentRepSide = null;
    this.currentRepPeak = 0;
    this.currentRepStartedAt = 0;
    this.currentRepKneeVelocities = [];
    this.currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
    this.currentRepWarnings = new Set();
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('KNEES', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------

  /** Core landmark set: shoulders + hips + knees + ankles (the engine reads
   *  shoulders and knees per frame; hips/ankles are required by the
   *  full-body context the user sees). */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE])     && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE])    && lmVisible(landmarks[LM.RIGHT_ANKLE]);
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
    debugLog('KNEES', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  static readonly MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH_RUNTIME;
}
