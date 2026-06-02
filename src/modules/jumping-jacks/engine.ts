/**
 * JumpingJacksEngine — bilateral, front-camera, rep-based.
 *
 * Signal: composite openness combines arm openness (wrists above shoulders)
 * and leg openness (feet apart) into a single percent-of-shoulder-width
 * scalar that drives a 2-state machine with hysteresis.
 *
 * State machine (CLOSED ↔ OPEN):
 *   CLOSED — smoothed composite < CLOSED_THRESHOLD_PCT
 *     transition: smoothed composite > OPEN_THRESHOLD_PCT → OPEN
 *   OPEN   — smoothed composite > OPEN_THRESHOLD_PCT
 *     transition: smoothed composite < CLOSED_THRESHOLD_PCT → CLOSED (rep complete)
 *
 * One full cycle (CLOSED → OPEN → CLOSED) = one rep, counted on the
 * OPEN → CLOSED return. The hysteresis gap prevents transition-zone chatter.
 *
 * Posture warnings:
 *   - `torso-swing`     — shoulder-mid X drifts > 0.04 from baseline (gated to non-CLOSED)
 *   - `incomplete-jack` — rep complete but armPeak OR legPeak < MIN_REP_OPENNESS_PCT
 *   - `malformed-rep`   — ballistic (both axes too fast) / unilateral / too-fast
 *   - `not-moving`      — 5 s idle in CLOSED with < 2 % composite variance
 *   - `position-lost`   — no usable pose frame for ≥ 3 s post-cal
 *
 * Validation order (Fix D): unilateral → too-shallow → too-fast → ballistic.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM, lmVisible, MIN_SHOULDER_WIDTH_RUNTIME,
  armOpennessPct, legOpennessPct, perSideArmOpennessPct, perSideAnkleOffsetPct,
} from './geometry';
import { JumpingJacksCalibration } from './calibration';
import type {
  JumpingJacksBaseline, JumpingJacksEngineCallbacks, JumpingJacksFrameMetrics, JumpingJacksRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_COMPOSITE = 0.15;

// State-machine thresholds (% of shoulder width). Hysteresis gap = 30.
const CLOSED_THRESHOLD_PCT = 40;
const OPEN_THRESHOLD_PCT = 70;
const MIN_REP_OPENNESS_PCT = 50;          // both armPeak and legPeak must clear for accept

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle detection (Fix I + Fix O + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_PCT = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_PCT = 0.5;
const SETTLED_HOLD_MS = 500;

// Position-lost (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Rep shape (Fix D ordering: unilateral → too-shallow → too-fast → ballistic)
const MIN_REP_DURATION_MS = 250;          // jumping jacks are FAST — calf-raise's 400 ms is too strict
// Fix R — ballistic threshold tuning. Both wrist Y and ankle X spike during
// every legitimate jack, so a single-axis gate rejects every rep. Only reject
// when BOTH axes peak simultaneously beyond the threshold (genuine flailing).
const MAX_WRIST_Y_VELOCITY = 8.0;
const MAX_ANKLE_X_VELOCITY = 8.0;
const MIN_BILATERAL_SYMMETRY = 0.7;

export class JumpingJacksEngine {
  private callbacks: JumpingJacksEngineCallbacks;
  private calibration: JumpingJacksCalibration;
  private baseline: JumpingJacksBaseline | null = null;

  private repState: JumpingJacksRepState = 'CLOSED';

  private smoothedCompositePct = 0;
  private prevSmoothedCompositePct = 0;
  private compositeSeeded = false;

  private maxCompositeThisRep = 0;
  private maxArmThisRep = 0;
  private maxLegThisRep = 0;
  private peakLeftArmPct = 0;
  private peakRightArmPct = 0;
  private peakLeftAnkleOffsetPct = 0;
  private peakRightAnkleOffsetPct = 0;

  private repWristVelocities: number[] = [];
  private repAnkleXVelocities: number[] = [];
  private repFormCounts = { torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevLeftAnkleX = 0;
  private prevRightAnkleX = 0;
  private prevSampleTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection (CLOSED state)
  private closedSince = 0;
  private closedCompositeMin = Infinity;
  private closedCompositeMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O — post-rep EMA-decay reseed flags.
  private closedSettledSince = 0;
  private closedBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: JumpingJacksEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new JumpingJacksCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          // Seed smoothed composite from a clean estimate (CLOSED start).
          this.smoothedCompositePct = 0;
          this.compositeSeeded = false;     // re-seed on first tracking frame
          // Fix I + P: init idle tracking on cal-confirm.
          this.closedSince = now;
          this.closedCompositeMin = 0;
          this.closedCompositeMax = 0;
          this.lastValidFrameAt = now;
          debugLog('JACKS', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            shoulderMidX: +this.baseline.shoulderMidX.toFixed(3),
            shoulderMidY: +this.baseline.shoulderMidY.toFixed(3),
          });
        }
      }
      return;
    }

    // Position-lost runs regardless of whether the current frame has usable
    // landmarks (the whole point is to detect missing frames).
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'CLOSED';
    this.smoothedCompositePct = 0;
    this.prevSmoothedCompositePct = 0;
    this.compositeSeeded = false;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const coreOk = lmVisible(ls) && lmVisible(rs)
      && lmVisible(lw) && lmVisible(rw)
      && lmVisible(la) && lmVisible(ra);
    if (!coreOk) return;

    const shoulderY = (ls.y + rs.y) / 2;
    const avgWristY = (lw.y + rw.y) / 2;
    const sw = baseline.shoulderWidth;

    // Composite openness — average of arm and leg openness.
    const armPct = armOpennessPct(shoulderY, avgWristY, sw);
    const legPct = legOpennessPct(la.x, ra.x, sw);
    const rawComposite = (armPct + legPct) / 2;

    // EMA smoothing on the composite signal.
    this.smoothedCompositePct = this.compositeSeeded
      ? EMA_ALPHA_COMPOSITE * rawComposite + (1 - EMA_ALPHA_COMPOSITE) * this.smoothedCompositePct
      : rawComposite;
    this.compositeSeeded = true;

    // Per-side openness for symmetry check (used at rep completion).
    const leftArmPct = perSideArmOpennessPct(ls.y, lw.y, sw);
    const rightArmPct = perSideArmOpennessPct(rs.y, rw.y, sw);
    const bodyCenterX = (ls.x + rs.x) / 2;
    const leftAnkleOffsetPct = perSideAnkleOffsetPct(la.x, bodyCenterX, sw);
    const rightAnkleOffsetPct = perSideAnkleOffsetPct(ra.x, bodyCenterX, sw);

    // Velocity sampling — peak wrist Y velocity AND peak ankle X velocity.
    if (this.prevSampleTimestamp > 0) {
      const dt = (now - this.prevSampleTimestamp) / 1000;
      if (dt > 0) {
        const wristV = (avgWristY - this.prevWristY) / dt;
        const leftAnkleV = (la.x - this.prevLeftAnkleX) / dt;
        const rightAnkleV = (ra.x - this.prevRightAnkleX) / dt;
        // Track peak |Δ| for both ankles — record the larger of the two each frame.
        const ankleV = Math.max(Math.abs(leftAnkleV), Math.abs(rightAnkleV));
        if (this.repState === 'OPEN') {
          this.repWristVelocities.push(wristV);
          this.repAnkleXVelocities.push(ankleV);
        }
      }
    }
    this.prevWristY = avgWristY;
    this.prevLeftAnkleX = la.x;
    this.prevRightAnkleX = ra.x;
    this.prevSampleTimestamp = now;

    // Torso swing — shoulder midpoint X drift from baseline.
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Bilateral symmetry per-frame — used by form score.
    const armLo = Math.min(leftArmPct, rightArmPct);
    const armHi = Math.max(leftArmPct, rightArmPct);
    const legLo = Math.min(leftAnkleOffsetPct, rightAnkleOffsetPct);
    const legHi = Math.max(leftAnkleOffsetPct, rightAnkleOffsetPct);
    const armSymmetryOK = armHi < 5 || armLo / armHi >= MIN_BILATERAL_SYMMETRY;
    const legSymmetryOK = legHi < 5 || legLo / legHi >= MIN_BILATERAL_SYMMETRY;
    const symmetryOK = armSymmetryOK && legSymmetryOK;

    // Form accumulation during the OPEN phase (not while resting in CLOSED).
    if (this.repState !== 'CLOSED') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');

    // Fix A: posture warnings gated to active (non-CLOSED) phase. Casual sway
    // while resting between jacks should not fire warnings.
    if (this.repState !== 'CLOSED') {
      this.maybeEmitWarning('torso-swing', torsoSwingWarn, now);
    }

    // Per-rep peaks during OPEN.
    if (this.repState !== 'CLOSED') {
      if (rawComposite > this.maxCompositeThisRep) this.maxCompositeThisRep = rawComposite;
      if (armPct > this.maxArmThisRep) this.maxArmThisRep = armPct;
      if (legPct > this.maxLegThisRep) this.maxLegThisRep = legPct;
      if (leftArmPct > this.peakLeftArmPct) this.peakLeftArmPct = leftArmPct;
      if (rightArmPct > this.peakRightArmPct) this.peakRightArmPct = rightArmPct;
      if (leftAnkleOffsetPct > this.peakLeftAnkleOffsetPct) this.peakLeftAnkleOffsetPct = leftAnkleOffsetPct;
      if (rightAnkleOffsetPct > this.peakRightAnkleOffsetPct) this.peakRightAnkleOffsetPct = rightAnkleOffsetPct;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: JumpingJacksFrameMetrics = {
      armOpennessPct: armPct,
      legOpennessPct: legPct,
      compositeOpennessPct: rawComposite,
      smoothedCompositePct: this.smoothedCompositePct,
      leftArmOpennessPct: leftArmPct,
      rightArmOpennessPct: rightArmPct,
      leftAnkleOffsetPct,
      rightAnkleOffsetPct,
      repState: this.repState,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedCompositePct = this.smoothedCompositePct;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'CLOSED':
        if (this.smoothedCompositePct > OPEN_THRESHOLD_PCT) {
          this.repState = 'OPEN';
          // Fix C — reset buffers BEFORE setting repStartedAt (resetRepBuffers
          // zeros repStartedAt, so reversed order erases the timestamp).
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('JACKS', 'STATE', 'CLOSED → OPEN', {
            composite: +this.smoothedCompositePct.toFixed(2),
          });
        }
        break;

      case 'OPEN':
        if (this.smoothedCompositePct < CLOSED_THRESHOLD_PCT) {
          this.completeRep(now);
          this.repState = 'CLOSED';
          this.closedSince = now;
          this.closedCompositeMin = Infinity;
          this.closedCompositeMax = -Infinity;
          this.closedSettledSince = 0;
          this.closedBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: unilateral / bilateral symmetry check FIRST. A one-sided jack
    // (one arm up, other not) is more useful to flag as `unilateral` than
    // as `too-shallow`.
    const armPeakSum = this.peakLeftArmPct + this.peakRightArmPct;
    if (armPeakSum > 5) {
      const lo = Math.min(this.peakLeftArmPct, this.peakRightArmPct);
      const hi = Math.max(this.peakLeftArmPct, this.peakRightArmPct);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }
    const legPeakSum = this.peakLeftAnkleOffsetPct + this.peakRightAnkleOffsetPct;
    if (legPeakSum > 5) {
      const lo = Math.min(this.peakLeftAnkleOffsetPct, this.peakRightAnkleOffsetPct);
      const hi = Math.max(this.peakLeftAnkleOffsetPct, this.peakRightAnkleOffsetPct);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }
    // Both axes must clear MIN_REP_OPENNESS_PCT — arms-only or legs-only fails.
    if (this.maxArmThisRep < MIN_REP_OPENNESS_PCT) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.maxLegThisRep < MIN_REP_OPENNESS_PCT) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    // Ballistic: reject only when BOTH wrist AND ankle peak velocities exceed
    // the threshold simultaneously (genuine flailing — controlled jacks have
    // one or the other peaking, not both in lockstep).
    if (this.repWristVelocities.length > 0 && this.repAnkleXVelocities.length > 0) {
      const peakWristV = Math.max(...this.repWristVelocities.map(Math.abs));
      const peakAnkleV = Math.max(...this.repAnkleXVelocities.map(Math.abs));
      if (peakWristV > MAX_WRIST_Y_VELOCITY && peakAnkleV > MAX_ANKLE_X_VELOCITY) {
        return { ok: false, reason: 'ballistic' };
      }
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('JACKS', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakComposite: +this.maxCompositeThisRep.toFixed(2),
        peakArm: +this.maxArmThisRep.toFixed(2),
        peakLeg: +this.maxLegThisRep.toFixed(2),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-jack', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxCompositeThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxCompositeThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('JACKS', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'CLOSED') {
      this.closedSince = now;
      this.closedCompositeMin = this.smoothedCompositePct;
      this.closedCompositeMax = this.smoothedCompositePct;
      this.closedSettledSince = 0;
      this.closedBaselineReseeded = false;
      return;
    }
    if (this.smoothedCompositePct < this.closedCompositeMin) this.closedCompositeMin = this.smoothedCompositePct;
    if (this.smoothedCompositePct > this.closedCompositeMax) this.closedCompositeMax = this.smoothedCompositePct;
    // Fix O — post-rep EMA-decay reseed.
    if (!this.closedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedCompositePct - this.prevSmoothedCompositePct);
      if (emaDelta < SETTLED_DELTA_PCT) {
        if (this.closedSettledSince === 0) this.closedSettledSince = now;
        if (now - this.closedSettledSince >= SETTLED_HOLD_MS) {
          this.closedCompositeMin = this.smoothedCompositePct;
          this.closedCompositeMax = this.smoothedCompositePct;
          this.closedSince = now;
          this.closedBaselineReseeded = true;
        }
      } else {
        this.closedSettledSince = 0;
      }
    }
    const idleMs = now - this.closedSince;
    const variance = this.closedCompositeMax - this.closedCompositeMin;
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_PCT
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('JACKS', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        compositeVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.closedSince = now;
      this.closedCompositeMin = this.smoothedCompositePct;
      this.closedCompositeMax = this.smoothedCompositePct;
      this.closedSettledSince = 0;
      this.closedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxCompositeThisRep = 0;
    this.maxArmThisRep = 0;
    this.maxLegThisRep = 0;
    this.peakLeftArmPct = 0;
    this.peakRightArmPct = 0;
    this.peakLeftAnkleOffsetPct = 0;
    this.peakRightAnkleOffsetPct = 0;
    this.repWristVelocities = [];
    this.repAnkleXVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('JACKS', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------

  /** Jumping jacks core set: shoulders + wrists + ankles. (Hips/knees implied
   *  by the body shape but the engine only reads the 6 landmarks above per
   *  frame, so a tighter set keeps position-lost responsive.) */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_WRIST])    && lmVisible(landmarks[LM.RIGHT_WRIST])
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
    debugLog('JACKS', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // Geometry helpers — `MIN_SHOULDER_WIDTH_RUNTIME` is consumed by the
  // openness functions internally; nothing else in this file uses it.
  // (Reference for the floor: `geometry.ts`).
  static readonly MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH_RUNTIME;
}
