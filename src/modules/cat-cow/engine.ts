/**
 * CatCowEngine — rep-based tracker for Cat-Cow (Marjaryasana–Bitilasana).
 *
 * SIDE-ON camera, on hands and knees. The user alternately ARCHES the spine
 * (cow: chin/head lifts up) and ROUNDS it (cat: chin tucks down). One full
 * cat↔cow cycle = one rep.
 *
 * BlazePose has NO mid-spine landmarks, so the engine scores the **head/neck
 * pitch** as the proxy for spinal flexion-extension — the one large, slow,
 * side-on-reliable signal. `lift` = (neck pitch − the calibrated neutral). A
 * positive lift is cow/extension (head up); negative is cat/flexion (head down).
 *
 * Cycle detection (order-agnostic, with a neutral-return re-arm so a continuous
 * flow counts one rep per full oscillation, not per extreme):
 *   - lift > EXT_ENTRY  → `cowReached` (track peak extension)
 *   - lift < −FLEX_ENTRY → `catReached` (track peak flexion)
 *   - BOTH reached → complete the rep; require the head to pass back through the
 *     neutral band before the next cycle can start.
 *
 * Validation (Fix D order): shallow (peak extension OR flexion below the floor)
 * → `shallow-spine-rom`; too-fast → `malformed-rep`; ballistic (nose velocity)
 * → `malformed-rep`. Reused infra: not-moving (Fix I/O/P), position-lost (Fix N).
 *
 * ALL thresholds are in degrees of head pitch and WILL need physical-test tuning
 * (Fix R) — the side-camera head-pitch ROM is the unknown.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, neckPitchDeg, clampPitchDelta } from './geometry';
import { CatCowCalibration } from './calibration';
import type {
  CatCowBaseline, CatCowEngineCallbacks, CatCowFrameMetrics, CatCowRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_PITCH = 0.30;

// Lift thresholds (deg above/below the neutral baseline).
const EXT_ENTRY_DEG = 8;    // lift above this → entered cow (extension)
const FLEX_ENTRY_DEG = 8;   // lift below −this → entered cat (flexion)
const NEUTRAL_RETURN_DEG = 6; // head must return within this of neutral to re-arm
// Valid-rep ROM floors — a real cat-cow clearly arches AND rounds.
const MIN_EXT_DEG = 15;
const MIN_FLEX_DEG = 15;
// Cap raw peaks against MediaPipe nose outliers.
const MAX_REASONABLE_LIFT_DEG = 70;

// Cat-cow is a SLOW mobility flow.
const MIN_REP_DURATION_MS = 1000;
const MAX_NOSE_VELOCITY = 3.0;  // nu/sec — lenient; flailing trips it

// Hips should stay over the knees, not rock forward/back (form score only).
const HIP_DRIFT_THRESHOLD = 0.06;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_DEG = 0.5;
const SETTLED_HOLD_MS = 500;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class CatCowEngine {
  private callbacks: CatCowEngineCallbacks;
  private calibration: CatCowCalibration;
  private baseline: CatCowBaseline | null = null;

  private smoothedPitch = 0;
  private prevSmoothedPitch = 0;
  private pitchSeeded = false;

  private smoothedLift = 0;
  private prevSmoothedLift = 0;

  // Cycle tracking. `cowReached`/`catReached` mean the user crossed that
  // extreme's ENTRY threshold this cycle; the rep completes only once BOTH are
  // crossed AND the head returns to the neutral band (so the second extreme's
  // peak is fully captured, not just its entry).
  private cowReached = false;
  private catReached = false;
  private peakExt = 0;
  private peakFlex = 0;
  private cycleStartedAt = 0;
  private repNoseVelocities: number[] = [];
  private repFormCounts = { hipsStableCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevNose: { x: number; y: number } | null = null;
  private prevNoseTimestamp = 0;

  // Idle detection (NEUTRAL) + Fix O reseed.
  private neutralSince = 0;
  private neutralLiftMin = Infinity;
  private neutralLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private neutralSettledSince = 0;
  private neutralBaselineReseeded = false;

  // Position-lost (Fix N).
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: CatCowEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new CatCowCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          this.smoothedPitch = this.baseline.neutralPitchDeg;
          this.pitchSeeded = true;
          this.smoothedLift = 0;
          this.prevSmoothedLift = 0;
          this.neutralSince = now;
          this.neutralLiftMin = 0;
          this.neutralLiftMax = 0;
          this.lastValidFrameAt = now;
          debugLog('CATCOW', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            neutralPitch: +this.baseline.neutralPitchDeg.toFixed(1),
            bodyLengthX: +this.baseline.bodyLengthX.toFixed(3),
          });
        }
      }
      return;
    }

    const haveValidFrame = !!landmarks && this.baseline !== null && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.cowReached = false;
    this.catReached = false;
    this.smoothedLift = 0;
    this.prevSmoothedLift = 0;
    this.resetCycleBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const shoulder = landmarks[baseline.side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[baseline.side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const nose = landmarks[LM.NOSE];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(nose)) return;

    const rawPitch = neckPitchDeg(nose, shoulder);
    const clamped = this.pitchSeeded ? clampPitchDelta(rawPitch, this.smoothedPitch) : rawPitch;
    this.smoothedPitch = this.pitchSeeded
      ? EMA_ALPHA_PITCH * clamped + (1 - EMA_ALPHA_PITCH) * this.smoothedPitch
      : clamped;
    this.pitchSeeded = true;

    const rawLift = rawPitch - baseline.neutralPitchDeg;
    this.prevSmoothedLift = this.smoothedLift;
    this.smoothedLift = this.smoothedPitch - baseline.neutralPitchDeg;

    const inCycle = this.cowReached || this.catReached;

    const cow = this.smoothedLift > EXT_ENTRY_DEG;
    const cat = this.smoothedLift < -FLEX_ENTRY_DEG;

    // Start a cycle on the first extreme entry.
    if (!inCycle && (cow || cat)) {
      this.resetCycleBuffers();
      this.cycleStartedAt = now;
      this.prevNose = null;
    }
    if (cow) this.cowReached = true;
    if (cat) this.catReached = true;

    const activeCycle = this.cowReached || this.catReached;

    // Track peaks (RAW lift so EMA lag doesn't shave them) + velocity + form.
    if (activeCycle) {
      const cExt = Math.min(rawLift, MAX_REASONABLE_LIFT_DEG);
      const cFlex = Math.max(rawLift, -MAX_REASONABLE_LIFT_DEG);
      if (cExt > this.peakExt) this.peakExt = cExt;
      if (cFlex < this.peakFlex) this.peakFlex = cFlex;

      if (this.prevNoseTimestamp > 0 && this.prevNose) {
        const dt = (now - this.prevNoseTimestamp) / 1000;
        if (dt > 0) {
          const v = Math.hypot(nose.x - this.prevNose.x, nose.y - this.prevNose.y) / dt;
          this.repNoseVelocities.push(v);
        }
      }
      this.repFormCounts.totalCount++;
      if (Math.abs(hip.x - baseline.hipX) < HIP_DRIFT_THRESHOLD) this.repFormCounts.hipsStableCount++;
    }
    this.prevNose = { x: nose.x, y: nose.y };
    this.prevNoseTimestamp = now;

    // Complete a rep only once BOTH extremes were entered AND the head has
    // returned to the neutral band — by then both peaks are fully captured.
    if (this.cowReached && this.catReached && Math.abs(this.smoothedLift) < NEUTRAL_RETURN_DEG) {
      this.completeRep(now);
      this.cowReached = false;
      this.catReached = false;
      this.resetCycleBuffers();
      this.resetNeutralTracking(now);
    }

    this.checkNoMovement(this.cowReached || this.catReached ? 'IN_CYCLE' : 'NEUTRAL', now);

    const frameMetrics: CatCowFrameMetrics = {
      pitchLiftDeg: rawLift,
      smoothedLiftDeg: this.smoothedLift,
      repState: this.cowReached || this.catReached ? 'IN_CYCLE' : 'NEUTRAL',
      cowReached: this.cowReached,
      catReached: this.catReached,
    };
    this.callbacks.onFrame?.(frameMetrics);
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.peakExt < MIN_EXT_DEG || Math.abs(this.peakFlex) < MIN_FLEX_DEG) {
      return { ok: false, reason: 'shallow' };
    }
    if (this.cycleStartedAt > 0 && now - this.cycleStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repNoseVelocities.length > 0) {
      const peakV = Math.max(...this.repNoseVelocities.map(Math.abs));
      if (peakV > MAX_NOSE_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const totalRange = this.peakExt + Math.abs(this.peakFlex);
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.cycleStartedAt > 0 ? now - this.cycleStartedAt : 0;
      debugLog('CATCOW', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakExt: +this.peakExt.toFixed(1),
        peakFlex: +this.peakFlex.toFixed(1),
        totalRange: +totalRange.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'shallow') {
        this.maybeEmitWarning('shallow-spine-rom', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      return;
    }

    const smoothness = getSmoothnessScore(this.repNoseVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(totalRange);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(totalRange * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('CATCOW', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);
  }

  private resetCycleBuffers(): void {
    this.peakExt = 0;
    this.peakFlex = 0;
    this.cycleStartedAt = 0;
    this.repNoseVelocities = [];
    this.repFormCounts = { hipsStableCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
  }

  private resetNeutralTracking(now: number): void {
    this.neutralSince = now;
    this.neutralLiftMin = Infinity;
    this.neutralLiftMax = -Infinity;
    this.neutralSettledSince = 0;
    this.neutralBaselineReseeded = false;
  }

  private checkNoMovement(repState: CatCowRepState, now: number): void {
    if (repState !== 'NEUTRAL') {
      this.neutralSince = now;
      this.neutralLiftMin = this.smoothedLift;
      this.neutralLiftMax = this.smoothedLift;
      this.neutralSettledSince = 0;
      this.neutralBaselineReseeded = false;
      return;
    }
    if (this.smoothedLift < this.neutralLiftMin) this.neutralLiftMin = this.smoothedLift;
    if (this.smoothedLift > this.neutralLiftMax) this.neutralLiftMax = this.smoothedLift;
    // Fix O — post-rep EMA-decay reseed.
    if (!this.neutralBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedLift - this.prevSmoothedLift);
      if (emaDelta < SETTLED_DELTA_DEG) {
        if (this.neutralSettledSince === 0) this.neutralSettledSince = now;
        if (now - this.neutralSettledSince >= SETTLED_HOLD_MS) {
          this.neutralLiftMin = this.smoothedLift;
          this.neutralLiftMax = this.smoothedLift;
          this.neutralSince = now;
          this.neutralBaselineReseeded = true;
        }
      } else {
        this.neutralSettledSince = 0;
      }
    }
    const idleMs = now - this.neutralSince;
    const variance = this.neutralLiftMax - this.neutralLiftMin;
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('CATCOW', 'WARN', 'not-moving', { idleMs: Math.round(idleMs), variance: +variance.toFixed(2) });
      this.callbacks.onPostureWarning?.('not-moving');
      this.resetNeutralTracking(now);
    }
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('CATCOW', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection (camera-side nose + shoulder + hip)
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const side = this.baseline?.side ?? 'left';
    return lmVisible(landmarks[LM.NOSE])
      && lmVisible(landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP]);
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
    debugLog('CATCOW', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
