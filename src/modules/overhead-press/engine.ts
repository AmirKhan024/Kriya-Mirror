/**
 * OverheadPressEngine — bilateral rep tracker for front-camera overhead press.
 *
 * State machine (inverse of bicep-curl — pressing INCREASES elbow extension):
 *   RACKED (avg elbow flex ≥ RACKED_FLEX_THRESHOLD°, arms bent holding bar)
 *     → PRESSING (avg flex decreasing past PRESS_START_FLEX°, arms extending)
 *     → LOCKED_OUT (avg flex ≤ LOCKOUT_FLEX_THRESHOLD°, arms extended overhead)
 *     → LOWERING (avg flex increasing by DESCENT_FROM_PEAK_DEG°+ from locked peak)
 *     → RACKED (avg flex ≥ RACKED_RETURN_FLEX°, rep complete)
 *
 * Note on flex direction: elbowFlexionDeg returns the INTERIOR bend angle.
 *   Racked (~70–90° flex): arms bent, bar at shoulder level
 *   Pressing: flex DECREASES as arms extend overhead
 *   Locked out (~10–15° flex): arms fully extended
 *
 * Posture warnings:
 *   - `lower-back-arch`  — hip-to-shoulder horizontal offset during press
 *   - `bar-path-drift`   — wrist X drifts from baseline during press
 *   - `incomplete-press` — rep done but peak lockout flex > MIN_REP_DEPTH_DEG (155°→15°)
 *   - `malformed-rep`    — ballistic/too-fast/unilateral
 *   - `not-moving`       — 5s idle in RACKED state
 *   - `position-lost`    — no valid frame for ≥3s post-cal
 *   - `too-close` / `too-far` — calibration distance hints
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, elbowFlexionDeg, backArchOffset, wristPathDrift } from './geometry';
import { OHPCalibration } from './calibration';
import type {
  OHPBaseline, OHPEngineCallbacks, OHPFrameMetrics, OHPRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ─── Constants ─────────────────────────────────────────────────────────────
const EMA_ALPHA_ELBOW = 0.15;

// State machine thresholds (flex angle in degrees)
// Racked: arms bent, bar at shoulder/chest. Flex ≥ 65°
const RACKED_FLEX_THRESHOLD = 65;
// Press starts when flex drops below 60° (arms beginning to extend)
const PRESS_START_FLEX = 60;
// Locked out: arms extended overhead. Flex ≤ 25° (small residual bend ok)
const LOCKOUT_FLEX_THRESHOLD = 25;
// Top stability: need N frames near peak extension before counting lockout
const TOP_STABILITY_FRAMES = 6;
const TOP_STABILITY_DELTA = 3;    // degrees
// Descent from peak: flex must INCREASE by this much from lowest point to enter LOWERING
const DESCENT_FROM_PEAK_DEG = 10;
const DESCENDING_DELTA_MIN = 3;   // degrees per frame for immediate lowering detection
// Return to racked after lowering
const RACKED_RETURN_FLEX = 65;

// Rep quality thresholds
// MIN_REP_DEPTH: minimum lockout achieved. Peak flex must reach ≤ MIN_REP_DEPTH_DEG.
// If arms only reach 40° at best (not ≤ 25°), incomplete-press fires.
// Using 30° as threshold: arms must reach at least 30° flex (decent extension).
const MIN_REP_DEPTH_DEG = 30;
const MIN_REP_DURATION_MS = 500;
const MAX_WRIST_VELOCITY = 3.5;   // OHP is slower — tune at physical test
const MIN_BILATERAL_SYMMETRY = 0.70;

// Form warning thresholds
const BACK_ARCH_THRESHOLD = 0.06;         // hip-shoulder horizontal offset
const BAR_PATH_DRIFT_THRESHOLD = 0.04;    // wrist X-delta normalized
const BAR_PATH_DRIFT_DEBOUNCE = 8;        // frames
const BACK_ARCH_DEBOUNCE_FRAMES = 8;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix I: idle detection (5s timeout, initialize on cal-confirm)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// ─── Engine ────────────────────────────────────────────────────────────────
export class OverheadPressEngine {
  private callbacks: OHPEngineCallbacks;
  private calibration: OHPCalibration;
  private baseline: OHPBaseline | null = null;

  private repState: OHPRepState = 'RACKED';
  private smoothedFlex = 0;
  private prevSmoothedFlex = 0;
  private stableTopCount = 0;
  // minFlexThisRep: lowest flex reached this rep (= best lockout achieved)
  private minFlexThisRep = Infinity;
  private repWristVelocities: number[] = [];
  private repFormCounts = { archOKCount: 0, driftOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  // Per-rep tracking
  private repStartedAt = 0;
  private repPeakLeftElbowExtension = 0;  // max EXTENSION (min flex) per arm this rep
  private repPeakRightElbowExtension = 0;
  // Baseline wrist X for bar-path tracking (captured at cal-confirm)
  private baselineWristMidX = 0;

  // Fix I: idle detection (RACKED state idle tracking)
  private rackedSince = 0;
  private rackedFlexMin = Infinity;
  private rackedFlexMax = -Infinity;
  private lastNoMovementWarnAt = 0;  // Fix P: starts at 0 (cold-start sentinel)
  // Fix O: EMA-decay reseed tracking
  private rackedSettledSince = 0;
  private rackedBaselineReseeded = false;

  // Fix N: position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counters
  private backArchFrames = 0;
  private barPathDriftFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: OHPEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new OHPCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I: initialize idle tracking on cal-confirm (not in constructor)
        this.rackedSince = now;
        this.rackedFlexMin = this.smoothedFlex;
        this.rackedFlexMax = this.smoothedFlex;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        // Store baseline wrist mid X for bar-path tracking
        if (this.baseline) {
          const bl = this.baseline as OHPBaseline & { wristMidX?: number };
          this.baselineWristMidX = bl.wristMidX ?? this.baseline.shoulderMidX;
          debugLog('PRESS', 'CALIB', 'CONFIRMED', {
            shoulderY: +this.baseline.shoulderY.toFixed(3),
            wristY: +this.baseline.wristY.toFixed(3),
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs regardless of valid frame (post-cal)
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'RACKED';
    this.smoothedFlex = 0;
    this.prevSmoothedFlex = 0;
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
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(le) && lmVisible(re)
      && lmVisible(lw) && lmVisible(rw) && lmVisible(lh) && lmVisible(rh);
    if (!coreOk) return;

    // Bilateral elbow flex (lower = more extended = pressing more overhead)
    const leftFlex = elbowFlexionDeg(ls, le, lw);
    const rightFlex = elbowFlexionDeg(rs, re, rw);
    const rawFlex = (leftFlex + rightFlex) / 2;

    // EMA smoother (B10 pattern: init-0 branch is load-bearing for ballistic detection)
    this.smoothedFlex = this.smoothedFlex === 0
      ? rawFlex
      : EMA_ALPHA_ELBOW * rawFlex + (1 - EMA_ALPHA_ELBOW) * this.smoothedFlex;

    // Wrist Y velocity (drives smoothness — wrists travel farthest during OHP)
    const wristMidY = (lw.y + rw.y) / 2;
    const wristMidX = (lw.x + rw.x) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wristMidY - this.prevWristY) / dt;
        if (this.repState === 'PRESSING' || this.repState === 'LOWERING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wristMidY;
    this.prevWristTimestamp = now;

    // Back arch — horizontal offset between hips and shoulders
    // Only accumulate debounce during active rep phases (Fix A)
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const archVal = backArchOffset(hipMid, shoulderMid);
    const archActive = this.repState !== 'RACKED' && archVal > BACK_ARCH_THRESHOLD;
    this.backArchFrames = archActive ? this.backArchFrames + 1 : 0;
    const backArchWarn = this.backArchFrames >= BACK_ARCH_DEBOUNCE_FRAMES;

    // Bar path drift — wrist X deviation from baseline
    // Only accumulate debounce during active rep phases (Fix A)
    const driftVal = wristPathDrift(wristMidX, this.baselineWristMidX);
    const driftActive = this.repState !== 'RACKED' && driftVal > BAR_PATH_DRIFT_THRESHOLD;
    this.barPathDriftFrames = driftActive ? this.barPathDriftFrames + 1 : 0;
    const barPathWarn = this.barPathDriftFrames >= BAR_PATH_DRIFT_DEBOUNCE;

    // Bilateral symmetry per-frame
    // For OHP: symmetry means both arms extending similarly. Compare their flex values.
    // Lower flex = more extension. Use ratio of the less-extended to more-extended.
    const flexSum = leftFlex + rightFlex;
    // Both nearly straight (< 10° each) → symmetric
    const symmetryOK = flexSum < 10
      || (Math.max(leftFlex, rightFlex) > 0
          && Math.min(leftFlex, rightFlex) / Math.max(leftFlex, rightFlex) >= MIN_BILATERAL_SYMMETRY);

    // Form accumulation during active press phases
    if (this.repState !== 'RACKED') {
      this.repFormCounts.totalCount++;
      if (!backArchWarn) this.repFormCounts.archOKCount++;
      if (!barPathWarn) this.repFormCounts.driftOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (backArchWarn) this.repWarnings.add('lower-back-arch');
    if (barPathWarn) this.repWarnings.add('bar-path-drift');

    // Fix A: gate form coaching to active rep phase only
    if (this.repState !== 'RACKED') {
      this.maybeEmitWarning('lower-back-arch', backArchWarn, now);
      this.maybeEmitWarning('bar-path-drift', barPathWarn, now);
    }

    // Per-rep bilateral peak extension (for symmetry gate)
    // Extension = 180 - flex. Track max extension = min flex.
    if (this.repState !== 'RACKED') {
      const leftExt = 180 - leftFlex;
      const rightExt = 180 - rightFlex;
      if (leftExt > this.repPeakLeftElbowExtension) this.repPeakLeftElbowExtension = leftExt;
      if (rightExt > this.repPeakRightElbowExtension) this.repPeakRightElbowExtension = rightExt;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: OHPFrameMetrics = {
      elbowExtensionDeg: rawFlex,
      smoothedExtensionDeg: this.smoothedFlex,
      repState: this.repState,
      leftElbowDeg: leftFlex,
      rightElbowDeg: rightFlex,
      backArch: backArchWarn,
      barPathDrift: barPathWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlex = this.smoothedFlex;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'RACKED':
        // Start pressing when flex drops below PRESS_START_FLEX (arms beginning to extend)
        if (this.smoothedFlex < PRESS_START_FLEX) {
          this.repState = 'PRESSING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('PRESS', 'STATE', 'RACKED → PRESSING', { flex: +this.smoothedFlex.toFixed(1) });
        }
        break;

      case 'PRESSING': {
        // Track minimum flex (maximum extension) this rep
        if (this.smoothedFlex < this.minFlexThisRep) this.minFlexThisRep = this.smoothedFlex;
        const riseFromMin = this.smoothedFlex - this.minFlexThisRep;
        // Abort detection: user started lowering before reaching lockout stability.
        // If flex rises ≥ DESCENT_FROM_PEAK_DEG from the lowest point reached so
        // far and we are still in PRESSING (no stable top yet), treat this as an
        // aborted / ballistic rep — go straight to LOWERING so validateRepShape
        // can fire the appropriate warning (too-fast or incomplete-press).
        if (this.stableTopCount === 0 && riseFromMin >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('PRESS', 'STATE', 'PRESSING → LOWERING (abort)', {
            minFlex: +this.minFlexThisRep.toFixed(1),
            riseFromMin: +riseFromMin.toFixed(1),
          });
          break;
        }
        // Stability check at the top — no flex threshold required (mirrors
        // bicep-curl's CURLING state). Any stable peak (even a shallow 50° press)
        // transitions to LOCKED_OUT so validateRepShape can catch incomplete-press.
        const delta = Math.abs(this.smoothedFlex - this.prevSmoothedFlex);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'LOCKED_OUT';
            debugLog('PRESS', 'STATE', 'PRESSING → LOCKED_OUT', { minFlex: +this.minFlexThisRep.toFixed(1) });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'LOCKED_OUT': {
        // Track minimum flex (best lockout)
        if (this.smoothedFlex < this.minFlexThisRep) this.minFlexThisRep = this.smoothedFlex;
        // Detect start of lowering: flex increases (arms bending back down)
        const deltaUp = this.smoothedFlex - this.prevSmoothedFlex;
        const riseFromPeak = this.smoothedFlex - this.minFlexThisRep;
        if (deltaUp > DESCENDING_DELTA_MIN || riseFromPeak >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('PRESS', 'STATE', 'LOCKED_OUT → LOWERING', { minFlex: +this.minFlexThisRep.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        // Rep complete when flex returns to racked position
        if (this.smoothedFlex >= RACKED_RETURN_FLEX) {
          this.completeRep(now);
          this.repState = 'RACKED';
          this.rackedSince = now;
          this.rackedFlexMin = Infinity;
          this.rackedFlexMax = -Infinity;
          this.rackedSettledSince = 0;
          this.rackedBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: bilateral symmetry check FIRST. A deeply-extended-but-one-arm rep
    // should report malformed-rep (unilateral), not incomplete-press.
    const peakSum = this.repPeakLeftElbowExtension + this.repPeakRightElbowExtension;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftElbowExtension, this.repPeakRightElbowExtension);
      const hi = Math.max(this.repPeakLeftElbowExtension, this.repPeakRightElbowExtension);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }

    // Duration check BEFORE depth — a ballistic rep that completes the full
    // cycle but is too fast should be rejected as malformed-rep (not
    // incomplete-press). The EMA smoothing means very fast presses don't drive
    // the smoothed flex all the way to the lockout threshold, so the depth
    // check would fire first if not re-ordered here.
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }

    // Fix B: incomplete press — did arms not reach lockout threshold?
    // minFlexThisRep is the best extension achieved. If > MIN_REP_DEPTH_DEG, not extended enough.
    if (this.minFlexThisRep === Infinity || this.minFlexThisRep > MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }

    // Ballistic velocity check
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
      debugLog('PRESS', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        minFlex: this.minFlexThisRep === Infinity ? 'n/a' : +this.minFlexThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeakExt: +this.repPeakLeftElbowExtension.toFixed(1),
        rightPeakExt: +this.repPeakRightElbowExtension.toFixed(1),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-press', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.minFlexThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round((this.minFlexThisRep === Infinity ? 180 : this.minFlexThisRep) * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('PRESS', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // Fix I + Fix O: idle detection with EMA-decay reseed
  private checkNoMovement(now: number): void {
    if (this.repState !== 'RACKED') {
      // Reset idle tracking when actively pressing
      this.rackedSince = now;
      this.rackedFlexMin = this.smoothedFlex;
      this.rackedFlexMax = this.smoothedFlex;
      this.rackedSettledSince = 0;
      this.rackedBaselineReseeded = false;
      return;
    }

    // Track min/max flex while in RACKED state
    if (this.smoothedFlex < this.rackedFlexMin) this.rackedFlexMin = this.smoothedFlex;
    if (this.smoothedFlex > this.rackedFlexMax) this.rackedFlexMax = this.smoothedFlex;

    // Fix O: reseed once EMA has settled (post-rep EMA-decay reseed)
    if (!this.rackedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlex - this.prevSmoothedFlex);
      if (emaDelta < 0.3) {
        if (this.rackedSettledSince === 0) this.rackedSettledSince = now;
        if (now - this.rackedSettledSince >= 500) {
          this.rackedFlexMin = this.smoothedFlex;
          this.rackedFlexMax = this.smoothedFlex;
          this.rackedSince = now;
          this.rackedBaselineReseeded = true;
        }
      } else {
        this.rackedSettledSince = 0;
      }
    }

    const idleMs = now - this.rackedSince;
    const variance = this.rackedFlexMax - this.rackedFlexMin;
    // Fix P: cold-start sentinel (lastNoMovementWarnAt === 0 means never fired)
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('PRESS', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      // Reset idle window
      this.rackedSince = now;
      this.rackedFlexMin = this.smoothedFlex;
      this.rackedFlexMax = this.smoothedFlex;
      this.rackedSettledSince = 0;
      this.rackedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.minFlexThisRep = Infinity;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { archOKCount: 0, driftOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftElbowExtension = 0;
    this.repPeakRightElbowExtension = 0;
    this.backArchFrames = 0;
    this.barPathDriftFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    // Use -Infinity as the "never fired" sentinel so the very first fire within
    // the first 2.5 s of the session is not suppressed by the cooldown check.
    const last = this.warningCooldowns[type] ?? -Infinity;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('PRESS', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_ELBOW]) && lmVisible(landmarks[LM.RIGHT_ELBOW])
      && lmVisible(landmarks[LM.LEFT_WRIST]) && lmVisible(landmarks[LM.RIGHT_WRIST])
      && lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP]);
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
    debugLog('PRESS', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
