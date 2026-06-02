/**
 * OTEEngine — bilateral rep tracker for front-camera overhead tricep extension.
 *
 * Geometry: tricepExtDeg = (elbow.y − wrist.y) / upperArmLen × 90
 *   ≈ 90° = arms fully extended overhead (calibration / rest position)
 *   ≈  0° = forearms horizontal (good bottom depth)
 *   Negative = forearm has dropped below horizontal
 *
 * State machine (mirrors SQUAT's descent-then-ascent pattern):
 *   EXTENDED (extDeg > 70°) → LOWERING → AT_BOTTOM (stable) → PRESSING → EXTENDED
 *   Rep completes when PRESSING returns to EXTENDED threshold.
 *
 * Posture warnings:
 *   - `elbow-flare`               — elbows drift outward of shoulder baseline > 0.05
 *   - `torso-swing`               — shoulder midpoint x oscillates > 0.04 from baseline
 *   - `incomplete-tricep-extension` — rep complete but depth < MIN_REP_DEPTH
 *   - `malformed-rep`             — ballistic / too-fast / unilateral
 *   - `not-moving`                — 5s idle in EXTENDED
 *   - `position-lost`             — no usable landmarks for ≥ 3s post-cal
 *   - `too-close` / `too-far`     — distance hints (fired during calibration; retained post-cal)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, tricepExtDeg } from './geometry';
import { OTECalibration } from './calibration';
import type { OTEBaseline, OTEEngineCallbacks, OTEFrameMetrics, OTERepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.15;

// State machine thresholds (all in tricepExtDeg units, 0–90°).
const LOWER_START = 65;             // EXTENDED → LOWERING when extDeg drops below this
const BOTTOM_STABILITY_FRAMES = 8;  // frames of low delta to confirm AT_BOTTOM
const BOTTOM_STABILITY_DELTA = 3;   // max per-frame change (deg) to count as "stable"
const PRESSING_FROM_MIN_DEG = 10;   // extDeg must rise this much from the rep minimum to enter PRESSING
const PRESSING_DELTA_MIN = 3;       // per-frame rise (deg) to also trigger PRESSING from AT_BOTTOM
const EXTENDED_THRESHOLD = 70;      // PRESSING → EXTENDED (rep complete) when extDeg exceeds this

const MIN_REP_DEPTH_EXT_DEG = 40;   // extDeg must fall below this for the rep to be valid
                                     // (= depth ≥ 50°: wrists got at least halfway toward elbow level)
const MIN_BILATERAL_SYMMETRY = 0.70; // computed on depth metric: min(leftDepth,rightDepth)/max(...)

// Posture warning constants
const ELBOW_FLARE_THRESHOLD = 0.05;
const ELBOW_FLARE_DEBOUNCE_FRAMES = 8;
const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 5s idle warning (Fix I + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
// Wrist arc in overhead extension is comparable to bicep curl;
// 4.0 still rejects truly ballistic drops while allowing controlled tempo.
const MAX_WRIST_VELOCITY = 4.0;

export class OTEEngine {
  private callbacks: OTEEngineCallbacks;
  private calibration: OTECalibration;
  private baseline: OTEBaseline | null = null;

  private repState: OTERepState = 'EXTENDED';
  private smoothedExtDeg = 0;
  private prevSmoothedExtDeg = 0;
  private stableBottomCount = 0;
  private minExtDegThisRep = Infinity;       // lowest extDeg reached during the rep
  private repWristVelocities: number[] = [];
  private repFormCounts = { elbowOKCount: 0, torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  private repStartedAt = 0;
  private repMinLeftExtDeg = Infinity;
  private repMinRightExtDeg = Infinity;

  // Idle detection in EXTENDED (Fix I, Fix O, Fix P)
  private extendedSince = 0;
  private extendedFlexionMin = Infinity;
  private extendedFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private extendedSettledSince = 0;
  private extendedBaselineReseeded = false;

  // Position-lost (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counters
  private elbowFlareFrames = 0;
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: OTEEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new OTECalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I: seed idle tracking on cal-confirm, not at construction
        this.extendedSince = now;
        this.extendedFlexionMin = this.smoothedExtDeg;
        this.extendedFlexionMax = this.smoothedExtDeg;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('OTE', 'CALIB', 'CONFIRMED', {
            upperArmLen: +this.baseline.upperArmLen.toFixed(3),
            leftElbowX: +this.baseline.leftElbowX.toFixed(3),
            rightElbowX: +this.baseline.rightElbowX.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs regardless of whether landmarks are usable
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'EXTENDED';
    this.smoothedExtDeg = 0;
    this.prevSmoothedExtDeg = 0;
    this.stableBottomCount = 0;
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

    // Bilateral tricep extension depth metric
    const leftExt = tricepExtDeg(le, lw, baseline.upperArmLen);
    const rightExt = tricepExtDeg(re, rw, baseline.upperArmLen);
    const rawExtDeg = (leftExt + rightExt) / 2;

    // EMA smoothing (Fix B10: init branch so the first nonzero frame jumps to raw)
    this.smoothedExtDeg = this.smoothedExtDeg === 0
      ? rawExtDeg
      : EMA_ALPHA * rawExtDeg + (1 - EMA_ALPHA) * this.smoothedExtDeg;

    // Wrist Y velocity (drives smoothness score)
    const wristMidY = (lw.y + rw.y) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wristMidY - this.prevWristY) / dt;
        if (this.repState === 'LOWERING' || this.repState === 'PRESSING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wristMidY;
    this.prevWristTimestamp = now;

    // Elbow flare — elbows drift outward beyond shoulder baseline
    const leftElbowFlare = le.x - baseline.leftShoulderX < -ELBOW_FLARE_THRESHOLD;    // left elbow too far left
    const rightElbowFlare = re.x - baseline.rightShoulderX > ELBOW_FLARE_THRESHOLD;   // right elbow too far right
    const elbowFlareActive = leftElbowFlare || rightElbowFlare;
    this.elbowFlareFrames = elbowFlareActive ? this.elbowFlareFrames + 1 : 0;
    const elbowFlareWarn = this.elbowFlareFrames >= ELBOW_FLARE_DEBOUNCE_FRAMES;

    // Torso swing — shoulder midpoint X drifts from baseline
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Bilateral symmetry per-frame (for form score)
    const extSum = leftExt + rightExt;
    // Both close to 90° (extended) = symmetric. Both close to 0° = symmetric.
    // Asymmetry: one much lower than the other.
    const lo = Math.min(leftExt, rightExt);
    const hi = Math.max(leftExt, rightExt);
    const symmetryOK = hi <= 0 || lo / hi >= MIN_BILATERAL_SYMMETRY;
    void extSum;

    // Form accumulation during active phases
    if (this.repState !== 'EXTENDED') {
      this.repFormCounts.totalCount++;
      if (!elbowFlareWarn) this.repFormCounts.elbowOKCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (elbowFlareWarn) this.repWarnings.add('elbow-flare');
    if (torsoSwingWarn) this.repWarnings.add('torso-swing');

    // Fix A: gate form coaching to active rep phase only
    if (this.repState !== 'EXTENDED') {
      this.maybeEmitWarning('elbow-flare', elbowFlareWarn, now);
      this.maybeEmitWarning('torso-swing', torsoSwingWarn, now);
    }

    // Track per-arm minimum extension reached this rep
    if (this.repState !== 'EXTENDED') {
      if (leftExt < this.repMinLeftExtDeg) this.repMinLeftExtDeg = leftExt;
      if (rightExt < this.repMinRightExtDeg) this.repMinRightExtDeg = rightExt;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: OTEFrameMetrics = {
      tricepExtDeg: rawExtDeg,
      smoothedExtDeg: this.smoothedExtDeg,
      repState: this.repState,
      leftExtDeg: leftExt,
      rightExtDeg: rightExt,
      elbowFlare: elbowFlareWarn,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedExtDeg = this.smoothedExtDeg;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'EXTENDED':
        if (this.smoothedExtDeg < LOWER_START) {
          this.repState = 'LOWERING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('OTE', 'STATE', 'EXTENDED → LOWERING', { ext: +this.smoothedExtDeg.toFixed(1) });
        }
        break;

      case 'LOWERING': {
        this.minExtDegThisRep = Math.min(this.minExtDegThisRep, this.smoothedExtDeg);
        const delta = Math.abs(this.smoothedExtDeg - this.prevSmoothedExtDeg);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('OTE', 'STATE', 'LOWERING → AT_BOTTOM', { minExt: +this.minExtDegThisRep.toFixed(1) });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.minExtDegThisRep = Math.min(this.minExtDegThisRep, this.smoothedExtDeg);
        const riseFromMin = this.smoothedExtDeg - this.minExtDegThisRep;
        const deltaUp = this.smoothedExtDeg - this.prevSmoothedExtDeg;
        if (riseFromMin >= PRESSING_FROM_MIN_DEG || deltaUp > PRESSING_DELTA_MIN) {
          this.repState = 'PRESSING';
          debugLog('OTE', 'STATE', 'AT_BOTTOM → PRESSING', { minExt: +this.minExtDegThisRep.toFixed(1) });
        }
        break;
      }

      case 'PRESSING':
        if (this.smoothedExtDeg > EXTENDED_THRESHOLD) {
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
    // Fix D: check bilateral symmetry FIRST (unilateral is more specific than too-shallow)
    const leftDepth = 90 - (this.repMinLeftExtDeg === Infinity ? 90 : this.repMinLeftExtDeg);
    const rightDepth = 90 - (this.repMinRightExtDeg === Infinity ? 90 : this.repMinRightExtDeg);
    const depthSum = leftDepth + rightDepth;
    if (depthSum > 0) {
      const lo = Math.min(leftDepth, rightDepth);
      const hi = Math.max(leftDepth, rightDepth);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }

    if (this.minExtDegThisRep > MIN_REP_DEPTH_EXT_DEG) {
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
      debugLog('OTE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        minExtDeg: +this.minExtDegThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-tricep-extension', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const depthDeg = Math.max(0, 90 - this.minExtDegThisRep);
    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(depthDeg);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(depthDeg * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('OTE', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // Fix I + Fix O + Fix P: idle detection with EMA-decay reseed
  private checkNoMovement(now: number): void {
    if (this.repState !== 'EXTENDED') {
      this.extendedSince = now;
      this.extendedFlexionMin = this.smoothedExtDeg;
      this.extendedFlexionMax = this.smoothedExtDeg;
      this.extendedSettledSince = 0;
      this.extendedBaselineReseeded = false;
      return;
    }
    if (this.smoothedExtDeg < this.extendedFlexionMin) this.extendedFlexionMin = this.smoothedExtDeg;
    if (this.smoothedExtDeg > this.extendedFlexionMax) this.extendedFlexionMax = this.smoothedExtDeg;

    // Fix O: reseed once EMA has settled post-rep, so the decay tail doesn't
    // permanently inflate max-min and block `not-moving` from firing.
    if (!this.extendedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedExtDeg - this.prevSmoothedExtDeg);
      if (emaDelta < 0.3) {
        if (this.extendedSettledSince === 0) this.extendedSettledSince = now;
        if (now - this.extendedSettledSince >= 500) {
          this.extendedFlexionMin = this.smoothedExtDeg;
          this.extendedFlexionMax = this.smoothedExtDeg;
          this.extendedSince = now;
          this.extendedBaselineReseeded = true;
        }
      } else {
        this.extendedSettledSince = 0;
      }
    }

    const idleMs = now - this.extendedSince;
    const variance = this.extendedFlexionMax - this.extendedFlexionMin;
    // Fix P: cold-start cooldown — treat lastNoMovementWarnAt=0 as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('OTE', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.extendedSince = now;
      this.extendedFlexionMin = this.smoothedExtDeg;
      this.extendedFlexionMax = this.smoothedExtDeg;
      this.extendedSettledSince = 0;
      this.extendedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.minExtDegThisRep = Infinity;
    this.stableBottomCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { elbowOKCount: 0, torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repMinLeftExtDeg = Infinity;
    this.repMinRightExtDeg = Infinity;
    this.elbowFlareFrames = 0;
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('OTE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER])  && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_ELBOW])       && lmVisible(landmarks[LM.RIGHT_ELBOW])
      && lmVisible(landmarks[LM.LEFT_WRIST])       && lmVisible(landmarks[LM.RIGHT_WRIST])
      && lmVisible(landmarks[LM.LEFT_HIP])         && lmVisible(landmarks[LM.RIGHT_HIP]);
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
    debugLog('OTE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
