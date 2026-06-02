/**
 * CurtsyLungeEngine — rep-based tracker for front-camera Curtsy Lunge.
 *
 * The user stands facing the camera. They step one foot diagonally behind and
 * across the standing leg (curtsy), lowering the rear knee toward the floor.
 * The front (standing) leg bends — we track ITS knee angle as primary signal.
 *
 * Primary signal: front leg knee joint angle (hip → knee → ankle).
 *   STANDING  ~ 170°
 *   DEEP CURTSY ~ 90–100°
 *   (Lower angle = more bent = deeper curtsy)
 *
 * Secondary signal: rear ankle crossover (must cross ≥ 8% hip-width past midline).
 *
 * State machine:
 *   STANDING (knee > 155°) → DESCENDING (knee ≤ 155°) →
 *   AT_BOTTOM (stable 4+ frames at low Δ) → ASCENDING (knee rises from peak) →
 *   STANDING (knee > 155°, rep done)
 *
 * Warnings:
 *   - `incomplete-curtsy-lunge` — no crossover OR too shallow
 *   - `hip-rotation-curtsy`     — rear hip rises > 12% torsoHeight
 *   - `trunk-lean`              — torso > 45° from vertical
 *   - `knee-valgus`             — front knee caves inward > 18% hip-width
 *   - `malformed-rep`           — ballistic or too-fast rep
 *   - `not-moving`              — 5s idle in STANDING
 *   - `position-lost`           — no usable landmarks ≥ 3s post-cal
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { CurtsyLungeCalibration } from './calibration';
import type {
  CurtsyLungeBaseline,
  CurtsyLungeEngineCallbacks,
  CurtsyLungeFrameMetrics,
  CurtsyLungeRepEvent,
  CurtsyRepState,
} from './types';
import {
  computeKneeAngleDeg,
  detectActiveSide,
  computeCrossoverRatio,
  computeTrunkLeanDeg,
  detectHipRotation,
  LM,
  lmVisible,
  midpoint,
} from './geometry';
import { getSmoothnessScore, getFormScore, computeCurtsyMQS } from './scoring';
import { debugLog } from '@/lib/debug';

// NOTE: 'CURTSY-LUNGE' EngineTag and new WarningType entries ('trunk-lean',
// 'knee-valgus', 'incomplete-curtsy-lunge', 'hip-rotation-curtsy') are added
// by the Integration Agent. Until then we cast to silence TypeScript.
const ENGINE_TAG = 'CURTSY-LUNGE' as const;

// ── EMA smoothing ──────────────────────────────────────────────────────────
const EMA_ALPHA = 0.20;

// ── State machine thresholds — front leg knee JOINT angle (lower = more bent) ─
const DESCENT_START_DEG = 155;        // knee < 155° → DESCENDING
const AT_BOTTOM_THRESHOLD_DEG = 120;  // knee ≤ 120° → AT_BOTTOM candidate
const AT_BOTTOM_STABILITY_FRAMES = 4;
const AT_BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_BOTTOM_DEG = 10;   // rise 10° from peak → ASCENDING
const STANDING_THRESHOLD_DEG = 155;  // knee > 155° → STANDING (rep done)
const MIN_REP_DEPTH_DEG = 100;       // front knee must reach ≤ 100° for valid rep

// ── Crossover geometry ─────────────────────────────────────────────────────
const CROSSOVER_MIN_RATIO = 0.08;    // rear ankle must cross ≥ 8% hip-width past midline

// ── Timing ────────────────────────────────────────────────────────────────
const MIN_REP_DURATION_MS = 700;
const MAX_REP_DURATION_MS = 10000;
const MAX_HIP_VELOCITY = 1.5;

// ── Posture warnings ───────────────────────────────────────────────────────
const TRUNK_LEAN_DEG = 45;
const VALGUS_THRESHOLD_RATIO = 0.18;
const VALGUS_DEBOUNCE_FRAMES = 10;
const HIP_ROTATION_THRESHOLD = 0.12;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// ── Idle detection (Fix I + Fix P + Fix O) ────────────────────────────────
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// ── Position lost (Fix N) ─────────────────────────────────────────────────
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// ── Landmark indices ───────────────────────────────────────────────────────
const LM_LEFT_HIP = 23;
const LM_RIGHT_HIP = 24;
const LM_LEFT_KNEE = 25;
const LM_RIGHT_KNEE = 26;
const LM_LEFT_ANKLE = 27;
const LM_RIGHT_ANKLE = 28;
const LM_LEFT_SHOULDER = 11;
const LM_RIGHT_SHOULDER = 12;

export class CurtsyLungeEngine {
  private callbacks: CurtsyLungeEngineCallbacks;
  private calibration: CurtsyLungeCalibration;
  private baseline: CurtsyLungeBaseline | null = null;

  private repState: CurtsyRepState = 'STANDING';
  private frontLeg: 'left' | 'right' | null = null;
  private smoothedKneeAngle = 0;         // joint angle (higher = more straight)
  private prevSmoothedKneeAngle = 0;
  private stableBottomCount = 0;
  private peakDepthDeg = 180;            // minimum knee angle seen this rep (lower = deeper)
  private repHipVelocities: number[] = [];
  private repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;
  private repStartedAt = 0;
  private repCount = 0;
  private warningCount = 0;

  // Crossover tracking (per rep)
  private maxCrossoverRatioThisRep = 0;

  // Valgus debounce
  private valgusFrames = 0;

  // Idle detection (Fix I + Fix O)
  private standingSince = 0;
  private standingAngleMin = Infinity;
  private standingAngleMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: EMA baseline reseed post-rep
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Position lost (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: CurtsyLungeEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new CurtsyLungeCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix P: initialize idle tracking on cal-confirm (not at construction)
        this.standingSince = now;
        this.standingAngleMin = this.smoothedKneeAngle;
        this.standingAngleMax = this.smoothedKneeAngle;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog(ENGINE_TAG, 'CALIB', 'CONFIRMED', {
            hipWidth: +this.baseline.hipWidth.toFixed(3),
            torsoHeight: +this.baseline.torsoHeight.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: post-cal position-lost check runs regardless of whether the current
    // frame has usable landmarks.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.frontLeg = null;
    this.smoothedKneeAngle = 0;
    this.prevSmoothedKneeAngle = 0;
    this.stableBottomCount = 0;
    this.resetRepBuffers();
  }

  // ──────────────────────────────────────────────────────────────────────────
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh = landmarks[LM_LEFT_HIP];
    const rh = landmarks[LM_RIGHT_HIP];
    const lk = landmarks[LM_LEFT_KNEE];
    const rk = landmarks[LM_RIGHT_KNEE];
    const la = landmarks[LM_LEFT_ANKLE];
    const ra = landmarks[LM_RIGHT_ANKLE];
    const ls = landmarks[LM_LEFT_SHOULDER];
    const rs = landmarks[LM_RIGHT_SHOULDER];

    const coreOk = lmVisible(lh) && lmVisible(rh) && lmVisible(lk) && lmVisible(rk)
      && lmVisible(la) && lmVisible(ra) && lmVisible(ls) && lmVisible(rs);
    if (!coreOk) return;

    // Both legs' knee joint angles
    const leftKneeAngle = computeKneeAngleDeg(lh, lk, la);
    const rightKneeAngle = computeKneeAngleDeg(rh, rk, ra);

    // Determine front leg: the one with lower angle (more bent) is active/front.
    // While STANDING: detect onset from whichever leg starts bending first.
    // Once locked into a rep: track only the front leg's angle.
    const frontLegAngle = this.frontLeg === 'left' ? leftKneeAngle
      : this.frontLeg === 'right' ? rightKneeAngle
      : Math.min(leftKneeAngle, rightKneeAngle);  // min = more bent leg

    const rawAngle = frontLegAngle;
    // EMA smoothing (=0 init branch for ballistic detection — see B10)
    this.smoothedKneeAngle = this.smoothedKneeAngle === 0
      ? rawAngle
      : EMA_ALPHA * rawAngle + (1 - EMA_ALPHA) * this.smoothedKneeAngle;

    // Trunk lean
    const trunkDeg = computeTrunkLeanDeg(landmarks);

    // Hip-Y velocity for smoothness
    const hipMid = midpoint(lh, rh);
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

    // Posture checks
    const valgusFront = this.detectFrontKneeValgus(landmarks, baseline);
    const trunkBad = trunkDeg >= TRUNK_LEAN_DEG;

    // Hip rotation on rear leg
    const effectiveFrontLeg = this.frontLeg ?? detectActiveSide(leftKneeAngle, rightKneeAngle);
    const hipRotation = this.repState !== 'STANDING'
      ? detectHipRotation(landmarks, baseline, effectiveFrontLeg, HIP_ROTATION_THRESHOLD)
      : false;

    // Crossover ratio tracking
    const crossoverRatio = this.frontLeg !== null
      ? computeCrossoverRatio(landmarks, baseline, this.frontLeg)
      : 0;
    if (this.repState !== 'STANDING' && crossoverRatio > this.maxCrossoverRatioThisRep) {
      this.maxCrossoverRatioThisRep = crossoverRatio;
    }

    // Form accumulation
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!valgusFront) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
    }

    // NOTE: 'knee-valgus', 'trunk-lean', 'hip-rotation-curtsy' are new WarningType
    // entries added by the Integration Agent. Cast to WarningType until then.
    if (valgusFront) this.repWarnings.add('knee-valgus' as WarningType);
    if (trunkBad) this.repWarnings.add('trunk-lean' as WarningType);
    if (hipRotation) this.repWarnings.add('hip-rotation-curtsy' as WarningType);

    // Fix A: gate form coaching warnings to active rep phase
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.maybeEmitWarning('knee-valgus' as WarningType, valgusFront, now);
      this.maybeEmitWarning('trunk-lean' as WarningType, trunkBad, now);
      this.maybeEmitWarning('hip-rotation-curtsy' as WarningType, hipRotation, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now, leftKneeAngle, rightKneeAngle, landmarks, baseline);

    const frameMetrics: CurtsyLungeFrameMetrics = {
      repState: this.repState,
      smoothedKneeFlexionDeg: this.smoothedKneeAngle,
      crossoverRatio,
      activeSide: this.frontLeg,
      trunkLeanDeg: trunkDeg,
      hipRotationDetected: hipRotation,
      repCount: this.repCount,
      warningCount: this.warningCount,
      calibrated: true,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedKneeAngle = this.smoothedKneeAngle;
  }

  // ──────────────────────────────────────────────────────────────────────────
  private advanceRepState(
    now: number,
    leftKneeAngle: number,
    rightKneeAngle: number,
    landmarks: PoseLandmarks,
    baseline: CurtsyLungeBaseline,
  ): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedKneeAngle < DESCENT_START_DEG) {
          // Lock the front leg — whichever has the lower (more bent) angle
          this.frontLeg = leftKneeAngle <= rightKneeAngle ? 'left' : 'right';
          this.repState = 'DESCENDING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog(ENGINE_TAG, 'STATE', 'STANDING → DESCENDING', {
            frontLeg: this.frontLeg,
            leftAngle: +leftKneeAngle.toFixed(1),
            rightAngle: +rightKneeAngle.toFixed(1),
          });
        }
        break;

      case 'DESCENDING': {
        // Track the minimum angle seen (lower = deeper)
        if (this.smoothedKneeAngle < this.peakDepthDeg) {
          this.peakDepthDeg = this.smoothedKneeAngle;
        }
        const delta = Math.abs(this.smoothedKneeAngle - this.prevSmoothedKneeAngle);
        if (this.smoothedKneeAngle <= AT_BOTTOM_THRESHOLD_DEG && delta < AT_BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= AT_BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog(ENGINE_TAG, 'STATE', 'DESCENDING → AT_BOTTOM', {
              peakDepth: +this.peakDepthDeg.toFixed(1),
            });
          }
        } else {
          this.stableBottomCount = 0;
          // Ballistic fast-return: if angle is rising significantly from peak, go to ASCENDING
          const riseFromPeak = this.smoothedKneeAngle - this.peakDepthDeg;
          if (riseFromPeak >= ASCENT_FROM_BOTTOM_DEG && this.smoothedKneeAngle - this.prevSmoothedKneeAngle > ASCENDING_DELTA_MIN) {
            this.repState = 'ASCENDING';
            debugLog(ENGINE_TAG, 'STATE', 'DESCENDING → ASCENDING (fast return)', {
              peakDepth: +this.peakDepthDeg.toFixed(1),
            });
          }
        }
        break;
      }

      case 'AT_BOTTOM': {
        if (this.smoothedKneeAngle < this.peakDepthDeg) {
          this.peakDepthDeg = this.smoothedKneeAngle;
        }
        // Rising: angle increases from minimum (more straight = ascending)
        const deltaSinceBottom = this.smoothedKneeAngle - this.peakDepthDeg;
        const perFrameDelta = this.smoothedKneeAngle - this.prevSmoothedKneeAngle;
        if (perFrameDelta > ASCENDING_DELTA_MIN || deltaSinceBottom >= ASCENT_FROM_BOTTOM_DEG) {
          this.repState = 'ASCENDING';
          debugLog(ENGINE_TAG, 'STATE', 'AT_BOTTOM → ASCENDING', {
            peakDepth: +this.peakDepthDeg.toFixed(1),
          });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedKneeAngle > STANDING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.frontLeg = null;
          this.standingSince = now;
          this.standingAngleMin = Infinity;
          this.standingAngleMax = -Infinity;
          // Fix O: reset reseed flags on STANDING transition
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  // Fix D: validation order — ballistic → crossover missing → too shallow → too fast
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 1. Ballistic velocity check
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }

    // 2. Crossover missing — not a real curtsy if no crossover
    if (this.maxCrossoverRatioThisRep < CROSSOVER_MIN_RATIO) {
      return { ok: false, reason: 'no-crossover' };
    }

    // 3. Too shallow — front knee didn't reach required depth
    if (this.peakDepthDeg > MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }

    // 4. Duration too short
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }

    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog(ENGINE_TAG, 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDepthDeg: +this.peakDepthDeg.toFixed(1),
        crossoverRatio: +this.maxCrossoverRatioThisRep.toFixed(3),
        durationMs: Math.round(durationMs),
        frontLeg: this.frontLeg,
      });
      // Fix D: emit appropriate warning based on reason
      if (validation.reason === 'no-crossover' || validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-curtsy-lunge' as WarningType, true, now);
        this.warningCount++;
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
        this.warningCount++;
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const mqs = computeCurtsyMQS(this.peakDepthDeg, Array.from(this.repWarnings), smoothness, form);

    this.repCount++;

    const repPayload: CurtsyLungeRepEvent = {
      peakDepthDeg: Math.round(this.peakDepthDeg * 10) / 10,
      frontLeg: this.frontLeg ?? 'left',
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog(ENGINE_TAG, 'REP', 'Rep complete', {
      ...repPayload,
      crossoverRatio: +this.maxCrossoverRatioThisRep.toFixed(3),
    });
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fix O: not-moving detection with EMA baseline reseed
  // ──────────────────────────────────────────────────────────────────────────
  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      // Fix O: reset reseed tracking when in an active rep
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }

    if (this.smoothedKneeAngle < this.standingAngleMin) this.standingAngleMin = this.smoothedKneeAngle;
    if (this.smoothedKneeAngle > this.standingAngleMax) this.standingAngleMax = this.smoothedKneeAngle;

    // Fix O: re-baseline once the EMA has settled post-rep (decay tail fix)
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedKneeAngle - this.prevSmoothedKneeAngle);
      if (emaDelta < 0.3) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingAngleMin = this.smoothedKneeAngle;
          this.standingAngleMax = this.smoothedKneeAngle;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    const idleMs = now - this.standingSince;
    const variance = this.standingAngleMax - this.standingAngleMin;
    // Fix P: cold-start sentinel — treat initial 0 as "never fired" and allow first fire
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog(ENGINE_TAG, 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        angleVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.warningCount++;
      // Reset idle tracking after firing
      this.standingSince = now;
      this.standingAngleMin = this.smoothedKneeAngle;
      this.standingAngleMax = this.smoothedKneeAngle;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.peakDepthDeg = 180;
    this.maxCrossoverRatioThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.valgusFrames = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Posture gates
  // ──────────────────────────────────────────────────────────────────────────
  private detectFrontKneeValgus(landmarks: PoseLandmarks, baseline: CurtsyLungeBaseline): boolean {
    if (this.frontLeg === null) return false;
    const knee = landmarks[this.frontLeg === 'left' ? LM_LEFT_KNEE : LM_RIGHT_KNEE];
    const ankle = landmarks[this.frontLeg === 'left' ? LM_LEFT_ANKLE : LM_RIGHT_ANKLE];

    const midlineX = (baseline.leftKneeX + baseline.rightKneeX) / 2;
    const sign = this.frontLeg === 'left' ? -1 : 1;
    const baselineKneeX = this.frontLeg === 'left' ? baseline.leftKneeX : baseline.rightKneeX;
    const baselineOffset = (baselineKneeX - midlineX) * sign;
    const currentOffset = (knee.x - midlineX) * sign;

    if (baselineOffset <= 0) return false;

    const collapseRatio = 1 - currentOffset / baselineOffset;
    const isValgus = collapseRatio > VALGUS_THRESHOLD_RATIO;

    // Also check knee crossed past ankle's lateral line
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
    const last = this.warningCooldowns[type];
    // Allow first fire (last is undefined/0) or after cooldown
    if (last !== undefined && last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog(ENGINE_TAG, 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fix N: position-lost detection
  // ──────────────────────────────────────────────────────────────────────────

  /** Same core-landmark check used inside processTrackingFrame. */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const required = [
      LM_LEFT_HIP, LM_RIGHT_HIP,
      LM_LEFT_KNEE, LM_RIGHT_KNEE,
      LM_LEFT_ANKLE, LM_RIGHT_ANKLE,
    ];
    return required.every(i => {
      const lm = landmarks[i];
      return !!lm && (lm.visibility ?? 0) > 0.4;
    });
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
    debugLog(ENGINE_TAG, 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
