/**
 * DeadBugEngine — rep-based tracker for side-camera dead bugs.
 *
 * The person lies on their back, arms pointing up, knees in tabletop (90°).
 * Each rep: one leg extends toward the floor (hip-knee-ankle angle increases
 * from ~90° resting to ~150° fully extended), then returns.
 *
 * Primary metric: smoothedExtension = max(0, hipKneeAnkleDeg - 90).
 *   0° at rest (tabletop), 60°+ at full extension.
 *
 * Active leg: whichever of left/right has the higher hip-knee-ankle angle
 * each frame — so unilateral reps are detected automatically.
 *
 * State machine (mirrors push-up with renamed states):
 *   AT_REST (ext ≤ 10°) → EXTENDING (ext > 15°) → AT_EXTENDED (stable 8+ frames)
 *   → RETURNING (ext drops 10° from peak or -3°/frame) → AT_REST (ext < 10°, rep complete)
 *
 * Warnings:
 *   'hip-lift-off'        — hip rises > 0.04 above calibrated floor during active rep
 *   'not-moving'          — 5 s idle at rest (Fix I + Fix P)
 *   'incomplete-dead-bug' — peak smoothedExtension < 40° at rep completion
 *   'malformed-rep'       — too-fast / ballistic / too-slow
 *   'position-lost'       — no usable pose frame for ≥ 3 s (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { DeadBugCalibration } from './calibration';
import type {
  DeadBugBaseline,
  DeadBugEngineCallbacks,
  DeadBugFrameMetrics,
  DeadBugRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ---------------------------------------------------------------------------
// MediaPipe landmark indices (inline — avoids cross-module import issues)
// ---------------------------------------------------------------------------
const LEFT_SHOULDER  = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP       = 23;
const RIGHT_HIP      = 24;
const LEFT_KNEE      = 25;
const RIGHT_KNEE     = 26;
const LEFT_ANKLE     = 27;
const RIGHT_ANKLE    = 28;

function lmVisible(lm: { visibility?: number } | undefined): lm is { x: number; y: number; visibility: number } {
  return (lm?.visibility ?? 0) > 0.5;
}

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------
const EMA_ALPHA = 0.15;

// Thresholds are set lower than squat/lunge because the hip-knee-ankle angle
// at legExtensionDeg=20 is only ~104° (extension~14°) due to 2D geometry.
const EXTEND_START_DEG    = 12;   // smoothedExtension > this → begin EXTENDING
// RAW threshold for returning to rest — use raw angle (not EMA-smoothed) since
// EMA lag would prevent the smoothed from reaching near-zero in short rep cycles.
const AT_REST_THRESHOLD_RAW = 5;  // rawExtension < this → back to AT_REST (RETURNING→AT_REST)

// Dead Bug has no natural pause at the bottom (unlike squat/pushup), so we
// don't use BOTTOM_STABILITY_FRAMES. Instead we detect the reversal point directly.
const ASCENDING_DELTA_MIN     = 3;
const ASCENT_FROM_PEAK_DEG    = 10;

const MIN_REP_DEPTH_DEG = 35;  // peak smoothedExtension must exceed this for valid rep

// Hip-lift gate
const HIP_LIFT_THRESHOLD     = 0.04;  // normalised Y units (screen y=0 is top)
const HIP_LIFT_DEBOUNCE_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle detection (Fix I + Fix P)
const NO_MOVEMENT_TIMEOUT_MS  = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS   = 15000;

// Rep validity
const MIN_REP_DURATION_MS = 600;
const MAX_REP_DURATION_MS = 8000;
const MAX_HIP_VELOCITY    = 2.0;   // Dead Bug is slow; less than squat 1.5 but looser than pushup 3.0

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS  = 10_000;

// ---------------------------------------------------------------------------
// Helper: hip-knee-ankle angle in degrees (angle at the knee)
// ---------------------------------------------------------------------------
function hipKneeAngleDeg(
  hip: { x: number; y: number },
  knee: { x: number; y: number },
  ankle: { x: number; y: number },
): number {
  const khX = hip.x - knee.x;
  const khY = hip.y - knee.y;
  const kaX = ankle.x - knee.x;
  const kaY = ankle.y - knee.y;
  const dot = khX * kaX + khY * kaY;
  const mag = Math.sqrt(khX ** 2 + khY ** 2) * Math.sqrt(kaX ** 2 + kaY ** 2);
  if (mag < 0.001) return 90;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export class DeadBugEngine {
  private callbacks: DeadBugEngineCallbacks;
  private calibration: DeadBugCalibration;
  private baseline: DeadBugBaseline | null = null;

  private repState: DeadBugRepState = 'AT_REST';
  private smoothedAngle = 0;       // EMA of raw max(leftAngle, rightAngle)
  private prevSmoothedAngle = 0;
  private smoothedExtension = 0;   // max(0, smoothedAngle - 90)
  private rawAngle = 0;            // current raw angle (stored for EMA reset on AT_REST entry)
  private rawExtension = 0;        // un-smoothed, for AT_REST_THRESHOLD_RAW check
  private maxExtensionThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { hipOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection (Fix I + Fix P)
  private restSince = 0;
  private restAngleMin = Infinity;
  private restAngleMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  // Fix O: EMA reseed after post-rep decay settles
  private restSettledSince = 0;
  private restBaselineReseeded = false;

  // Hip-lift debounce
  private hipLiftFrames = 0;

  // Fix N: position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: DeadBugEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new DeadBugCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Initialize idle tracking on cal-confirm (prevents instant not-moving)
        this.restSince = now;
        this.restAngleMin = this.smoothedAngle;
        this.restAngleMax = this.smoothedAngle;
        this.restSettledSince = 0;
        this.restBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('DEAD_BUG', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            bodyLength: +this.baseline.bodyLength.toFixed(3),
            hipY: +this.baseline.hipY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: post-cal position-lost check runs regardless of landmark validity
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'AT_REST';
    this.smoothedAngle = 0;
    this.prevSmoothedAngle = 0;
    this.smoothedExtension = 0;
    this.rawExtension = 0;
    this.resetRepBuffers();
  }

  // ---------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh  = landmarks[LEFT_HIP];
    const rh  = landmarks[RIGHT_HIP];
    const lk  = landmarks[LEFT_KNEE];
    const rk  = landmarks[RIGHT_KNEE];
    const la  = landmarks[LEFT_ANKLE];
    const ra  = landmarks[RIGHT_ANKLE];
    const ls  = landmarks[LEFT_SHOULDER];
    const rs  = landmarks[RIGHT_SHOULDER];

    // coreOk already checked by hasCoreLandmarks, but guard for type safety
    if (!lmVisible(lh) || !lmVisible(rh) || !lmVisible(lk) || !lmVisible(rk)
        || !lmVisible(la) || !lmVisible(ra) || !lmVisible(ls) || !lmVisible(rs)) {
      return;
    }

    // Active leg: whichever has the larger hip-knee-ankle angle (more extended)
    const leftAngle  = hipKneeAngleDeg(lh, lk, la);
    const rightAngle = hipKneeAngleDeg(rh, rk, ra);
    const rawAngle   = Math.max(leftAngle, rightAngle);
    this.rawAngle    = rawAngle;

    // EMA smoothing — seed with first real value
    this.smoothedAngle = this.smoothedAngle === 0
      ? rawAngle
      : EMA_ALPHA * rawAngle + (1 - EMA_ALPHA) * this.smoothedAngle;

    this.smoothedExtension = Math.max(0, this.smoothedAngle - 90);
    // Raw extension (un-smoothed) — used for the RETURNING→AT_REST threshold
    // check to avoid EMA lag preventing rep completion in short cycles.
    this.rawExtension = Math.max(0, rawAngle - 90);

    // Hip Y velocity — use average of both hips (body translates as a unit)
    const avgHipY = (lh.y + rh.y) / 2;
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (avgHipY - this.prevHipY) / dt;
        if (this.repState === 'EXTENDING' || this.repState === 'RETURNING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = avgHipY;
    this.prevHipTimestamp = now;

    // Hip-lift detection: in screen coords y=0 is top.
    // "Hip lifted off mat" means avgHipY moved upward (smaller y).
    // Check: (baseline.hipY - avgHipY) > HIP_LIFT_THRESHOLD
    const hipLiftRaw = (baseline.hipY - avgHipY) > HIP_LIFT_THRESHOLD;
    this.hipLiftFrames = hipLiftRaw ? this.hipLiftFrames + 1 : 0;
    const hipLiftWarn = this.hipLiftFrames >= HIP_LIFT_DEBOUNCE_FRAMES;

    // Form accumulation during active phases
    const inActiveRep = this.repState !== 'AT_REST';
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!hipLiftWarn) this.repFormCounts.hipOKCount++;
    }

    if (hipLiftWarn) this.repWarnings.add('hip-lift-off');

    // Fix A: only coach form during the active rep phase
    if (inActiveRep) {
      this.maybeEmitWarning('hip-lift-off', hipLiftWarn, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: DeadBugFrameMetrics = {
      kneeAngleDeg: rawAngle,
      smoothedExtensionDeg: this.smoothedExtension,
      repState: this.repState,
      hipLiftAmount: Math.max(0, baseline.hipY - avgHipY),
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedAngle = this.smoothedAngle;
  }

  // ---------------------------------------------------------------------------
  // Dead Bug uses a 3-state machine (no stable-bottom requirement).
  // Dead Bug has no natural pause at the bottom — the motion is a smooth
  // arc from tabletop → extended → back to tabletop. We detect the reversal
  // point by tracking the drop from the peak extension, and use the raw
  // (un-smoothed) extension for the return-to-rest check to avoid EMA lag.
  // ---------------------------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'AT_REST':
        if (this.smoothedExtension > EXTEND_START_DEG) {
          this.repState = 'EXTENDING';
          // Fix C: reset FIRST, then set repStartedAt (resetRepBuffers zeros it)
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('DEAD_BUG', 'STATE', 'AT_REST → EXTENDING', {
            ext: +this.smoothedExtension.toFixed(1),
          });
        }
        break;

      case 'EXTENDING': {
        this.maxExtensionThisRep = Math.max(this.maxExtensionThisRep, this.smoothedExtension);
        const prevExt = Math.max(0, this.prevSmoothedAngle - 90);
        const deltaDown = this.smoothedExtension - prevExt;
        const dropFromPeak = this.maxExtensionThisRep - this.smoothedExtension;
        // Detect reversal: extension dropped 10° from peak, or clearly descending.
        // This replaces the stability gate used in squat/pushup — Dead Bug has no
        // natural pause at the bottom so stability never accumulates.
        if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || deltaDown < -ASCENDING_DELTA_MIN) {
          this.repState = 'RETURNING';
          debugLog('DEAD_BUG', 'STATE', 'EXTENDING → RETURNING', {
            peak: +this.maxExtensionThisRep.toFixed(1),
            dropFromPeak: +dropFromPeak.toFixed(1),
          });
        }
        break;
      }

      case 'AT_EXTENDED':
        // Pass-through: not reached in normal flow (kept for type completeness).
        this.repState = 'RETURNING';
        break;

      case 'RETURNING':
        // Use RAW extension (not EMA-smoothed) for the return-to-rest check.
        // EMA lag would prevent the smoothed from reaching near-zero in normal
        // 1–2 second rep cycles, causing reps to never complete.
        if (this.rawExtension < AT_REST_THRESHOLD_RAW) {
          this.completeRep(now);
          this.repState = 'AT_REST';
          // Reset EMA to current raw angle so the next rep starts from an
          // accurate baseline. Without this, EMA lag keeps smoothedExtension
          // elevated (e.g. at 20°), which immediately re-triggers EXTENDING
          // and produces a spurious too-shallow rejection warning.
          this.smoothedAngle     = this.rawAngle;
          this.prevSmoothedAngle = this.rawAngle;
          this.smoothedExtension = 0;
          this.restSince = now;
          this.restAngleMin = Infinity;
          this.restAngleMax = -Infinity;
          this.restSettledSince = 0;
          this.restBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 1. Too shallow — primary quality gate
    if (this.maxExtensionThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    // 2. Too fast (ballistic by duration)
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    // 3. Ballistic by velocity
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    // 4. Too slow — hesitation / stuck mid-rep
    if (this.repStartedAt > 0 && now - this.repStartedAt > MAX_REP_DURATION_MS) {
      return { ok: false, reason: 'too-slow' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('DEAD_BUG', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakExtension: +this.maxExtensionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-dead-bug', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness  = getSmoothnessScore(this.repHipVelocities);
    const form        = getFormScore(this.repFormCounts);
    const completion  = getCompletionScore(this.maxExtensionThisRep);
    const mqs         = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg:   Math.round(this.maxExtensionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form:       Math.round(form),
      mqs:        Math.round(mqs),
      warnings:   Array.from(this.repWarnings),
    };
    debugLog('DEAD_BUG', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ---------------------------------------------------------------------------
  // Idle detection (Fix I + Fix P + Fix O)
  // ---------------------------------------------------------------------------
  private checkNoMovement(now: number): void {
    if (this.repState !== 'AT_REST') {
      // Active rep — reset idle baseline
      this.restSince = now;
      this.restAngleMin = this.smoothedAngle;
      this.restAngleMax = this.smoothedAngle;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
      return;
    }

    if (this.smoothedAngle < this.restAngleMin) this.restAngleMin = this.smoothedAngle;
    if (this.smoothedAngle > this.restAngleMax) this.restAngleMax = this.smoothedAngle;

    // Fix O: re-baseline once the post-rep EMA decay has settled (< 0.3°/frame
    // for 500 ms), so the decay tail doesn't permanently inflate min-max and
    // prevent the not-moving warning from ever firing.
    if (!this.restBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedAngle - this.prevSmoothedAngle);
      if (emaDelta < 0.3) {
        if (this.restSettledSince === 0) this.restSettledSince = now;
        if (now - this.restSettledSince >= 500) {
          this.restAngleMin = this.smoothedAngle;
          this.restAngleMax = this.smoothedAngle;
          this.restSince = now;
          this.restBaselineReseeded = true;
        }
      } else {
        this.restSettledSince = 0;
      }
    }

    const idleMs   = now - this.restSince;
    const variance = this.restAngleMax - this.restAngleMin;

    // Cold-start fix: treat lastNoMovementWarnAt === 0 as "never fired", so
    // the first warning fires even when now < NO_MOVEMENT_REPEAT_MS.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS && variance < NO_MOVEMENT_VARIANCE_DEG && firstFireAllowed) {
      this.lastNoMovementWarnAt = now;
      debugLog('DEAD_BUG', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        angleVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.restSince = now;
      this.restAngleMin = this.smoothedAngle;
      this.restAngleMax = this.smoothedAngle;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Fix N: position-lost detection
  // ---------------------------------------------------------------------------

  /** Same landmark set as processTrackingFrame's coreOk check. */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LEFT_HIP])  && lmVisible(landmarks[RIGHT_HIP])
      && lmVisible(landmarks[LEFT_KNEE])   && lmVisible(landmarks[RIGHT_KNEE])
      && lmVisible(landmarks[LEFT_ANKLE])  && lmVisible(landmarks[RIGHT_ANKLE])
      && lmVisible(landmarks[LEFT_SHOULDER])  && lmVisible(landmarks[RIGHT_SHOULDER]);
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
    debugLog('DEAD_BUG', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ---------------------------------------------------------------------------
  private resetRepBuffers(): void {
    this.maxExtensionThisRep = 0;
    this.repHipVelocities    = [];
    this.repFormCounts       = { hipOKCount: 0, totalCount: 0 };
    this.repWarnings         = new Set();
    this.repStartedAt        = 0;
    this.hipLiftFrames       = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('DEAD_BUG', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
