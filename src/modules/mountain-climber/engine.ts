/**
 * MountainClimberEngine — rep-based tracker for side-camera mountain climbers.
 *
 * The user is in a high plank (horizontal body). Each knee drive toward the
 * chest = 1 rep. The engine tracks hip alignment (hip-sag / pike) and knee
 * drive depth using the shoulder→hip→knee angle.
 *
 * State machine:
 *   PLANK (angle > HIP_KNEE_REST_DEG=140°)
 *   → DRIVING (angle falling past DRIVE_ENTER_DEG=120°)
 *   → KNEE_AT_CHEST (angle ≤ KNEE_PEAK_DEG=70°, stable or reversing)
 *   → EXTENDING (angle increasing back toward rest)
 *   → PLANK (angle > DRIVE_EXIT_DEG=130°, rep complete)
 *
 * All Fixes A–R applied.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, hipPlankDeviation, kneeHipAngleDeg } from './geometry';
import { MountainClimberCalibration } from './calibration';
import type {
  MountainClimberBaseline,
  MountainClimberEngineCallbacks,
  MountainClimberFrameMetrics,
  MountainClimberRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// State machine thresholds
const EMA_ALPHA_KNEE = 0.20;               // mountain climbers are fast; higher alpha
const HIP_KNEE_REST_DEG = 140;             // leg extended (PLANK)
const DRIVE_ENTER_DEG = 120;               // start DRIVING when angle drops below this
const DRIVE_EXIT_DEG = 130;                // return to PLANK when angle rises above this (hysteresis)
const KNEE_PEAK_DEG = 70;                  // Fix B: minimum drive depth for valid rep

// Alignment detection
const HIP_SAG_THRESHOLD = 0.04;
const HIP_PIKE_THRESHOLD = 0.04;
const HIP_DEBOUNCE_FRAMES = 6;

// Rep validation
const MIN_REP_DURATION_MS = 200;           // mountain climbers can be very fast
const MAX_KNEE_VELOCITY = 4.0;             // Fix R: knee travels fast in mountain climbers
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle detection (Fix I + P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class MountainClimberEngine {
  private callbacks: MountainClimberEngineCallbacks;
  private calibration: MountainClimberCalibration;
  private baseline: MountainClimberBaseline | null = null;

  private repState: MountainClimberRepState = 'PLANK';

  // Primary metric: smoothed shoulder→hip→knee angle
  private smoothedKneeAngle = 0;
  private prevSmoothedKneeAngle = 0;

  // Peak angle during drive (lowest value = most driven = best)
  private peakKneeAngleDriven = 180;   // tracks minimum angle reached this rep

  // Velocity tracking (Fix R: ballistic rejection)
  // Tracks normalised knee-position speed (units/s) — same convention as
  // pushup's shoulder-Y velocity (MAX_SHOULDER_VELOCITY = 3.0).
  // Normal mountain-climber motion: ~0.15 normalised units over 500ms ≈ 0.3/s.
  // Ballistic jitter spike: knee jumps 0.10+ in a single 33ms frame ≈ 3+ /s.
  private repKneeVelocities: number[] = [];
  private prevKneeX = 0;
  private prevKneeY = 0;
  private prevTimestamp = 0;

  // Form tracking
  private repFormCounts = { hipOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Posture debounce
  private hipSagFrames = 0;
  private hipPikeFrames = 0;

  // Rep timing (Fix C)
  private repStartedAt = 0;

  // Pace tracking: timestamps of completed reps for rolling reps-per-minute
  private repTimestamps: number[] = [];

  // Idle detection (Fix I + O + P)
  private plankSince = 0;
  private plankAngleMin = Infinity;
  private plankAngleMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: EMA reseed after rep
  private plankSettledSince = 0;
  private plankBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: MountainClimberEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new MountainClimberCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I: initialize idle tracking on cal-confirm.
        // Use Infinity/-Infinity so the first tracking frame seeds the range correctly
        // (smoothedKneeAngle is still 0 at cal-confirm time and must not be used).
        this.plankSince = now;
        this.plankAngleMin = Infinity;
        this.plankAngleMax = -Infinity;
        // Fix O: init settle tracking
        this.plankSettledSince = 0;
        this.plankBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('MTNCLIMB', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            bodyLengthX: +this.baseline.bodyLengthX.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: post-cal position-lost check runs regardless of frame validity
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'PLANK';
    this.smoothedKneeAngle = 0;
    this.prevSmoothedKneeAngle = 0;
    this.peakKneeAngleDriven = 180;
    this.repTimestamps = [];
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    // BUG-MC-02 FIX: mountain climber uses side-on camera; the far side is
    // consistently low-confidence. Requiring ALL 8 landmarks bilateral means
    // haveValidFrame is almost always false post-calibration → engine is dead.
    // Use only the calibrated side's landmarks (same set processTrackingFrame uses).
    const side = this.baseline?.side;
    if (!side) {
      // Pre-calibration: accept any hip + knee pair visible
      return (lmVisible(landmarks[LM.LEFT_HIP]) || lmVisible(landmarks[LM.RIGHT_HIP]))
          && (lmVisible(landmarks[LM.LEFT_KNEE]) || lmVisible(landmarks[LM.RIGHT_KNEE]));
    }
    const s = side === 'left';
    return lmVisible(landmarks[s ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER])
        && lmVisible(landmarks[s ? LM.LEFT_HIP      : LM.RIGHT_HIP])
        && lmVisible(landmarks[s ? LM.LEFT_KNEE     : LM.RIGHT_KNEE])
        && lmVisible(landmarks[s ? LM.LEFT_ANKLE    : LM.RIGHT_ANKLE]);
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
    debugLog('MTNCLIMB', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    const coreOk = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
    if (!coreOk) return;

    // Primary metric: shoulder→hip→knee angle
    // This DECREASES as knee drives toward chest
    const rawKneeAngle = kneeHipAngleDeg(shoulder, hip, knee);

    // Fix R: EMA init branch — use raw on first frame
    this.smoothedKneeAngle = this.smoothedKneeAngle === 0
      ? rawKneeAngle
      : EMA_ALPHA_KNEE * rawKneeAngle + (1 - EMA_ALPHA_KNEE) * this.smoothedKneeAngle;

    // Velocity tracking for ballistic detection (Fix R)
    // Uses normalised knee position speed (units/s) — same convention as
    // pushup's shoulder-Y velocity. Normal: ~0.30/s. Ballistic spike: > 4.0/s.
    if (this.prevTimestamp > 0) {
      const dt = (now - this.prevTimestamp) / 1000;
      if (dt > 0) {
        const dx = knee.x - this.prevKneeX;
        const dy = knee.y - this.prevKneeY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const v = dist / dt;
        if (this.repState !== 'PLANK') {
          this.repKneeVelocities.push(v);
        }
      }
    }
    this.prevKneeX = knee.x;
    this.prevKneeY = knee.y;
    this.prevTimestamp = now;

    // Hip-line deviation (line-relative metric — Fix B9 / pushup pattern)
    const hipLineDelta = hipPlankDeviation(
      shoulder.x, shoulder.y,
      hip.x, hip.y,
      ankle.x, ankle.y,
    );
    const sagging = hipLineDelta > HIP_SAG_THRESHOLD;
    const piked = hipLineDelta < -HIP_PIKE_THRESHOLD;

    // Debounce
    this.hipSagFrames = sagging ? this.hipSagFrames + 1 : 0;
    this.hipPikeFrames = piked ? this.hipPikeFrames + 1 : 0;

    const hipSagWarn = this.hipSagFrames >= HIP_DEBOUNCE_FRAMES;
    const hipPikeWarn = this.hipPikeFrames >= HIP_DEBOUNCE_FRAMES;

    // Form accumulation during active rep phases
    if (this.repState !== 'PLANK') {
      this.repFormCounts.totalCount++;
      if (!hipSagWarn && !hipPikeWarn) this.repFormCounts.hipOKCount++;
    }

    if (hipSagWarn) this.repWarnings.add('hip-sag');
    if (hipPikeWarn) this.repWarnings.add('hip-pike');

    // Fix A: only coach form during active rep phase (not resting in PLANK)
    const inActiveRep = this.repState !== 'PLANK';
    if (inActiveRep) {
      this.maybeEmitWarning('hip-sag', hipSagWarn, now);
      this.maybeEmitWarning('hip-pike', hipPikeWarn, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: MountainClimberFrameMetrics = {
      kneeHipAngleDeg: rawKneeAngle,
      smoothedKneeAngleDeg: this.smoothedKneeAngle,
      repState: this.repState,
      hipSagAmount: Math.max(0, hipLineDelta),
      hipPikeAmount: Math.max(0, -hipLineDelta),
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedKneeAngle = this.smoothedKneeAngle;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'PLANK':
        // Knee angle starts high (~170°) and drops as knee drives forward
        if (this.smoothedKneeAngle < DRIVE_ENTER_DEG) {
          this.repState = 'DRIVING';
          // Fix C: resetRepBuffers FIRST, then repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          this.peakKneeAngleDriven = this.smoothedKneeAngle; // init at current
          debugLog('MTNCLIMB', 'STATE', 'PLANK → DRIVING', { angle: +this.smoothedKneeAngle.toFixed(1) });
        }
        break;

      case 'DRIVING':
        // Track minimum angle (peak drive depth)
        if (this.smoothedKneeAngle < this.peakKneeAngleDriven) {
          this.peakKneeAngleDriven = this.smoothedKneeAngle;
        }
        // Transition to KNEE_AT_CHEST when angle reaches peak depth
        if (this.smoothedKneeAngle <= KNEE_PEAK_DEG) {
          this.repState = 'KNEE_AT_CHEST';
          debugLog('MTNCLIMB', 'STATE', 'DRIVING → KNEE_AT_CHEST', { angle: +this.smoothedKneeAngle.toFixed(1) });
        } else if (this.smoothedKneeAngle > this.peakKneeAngleDriven + 5) {
          // Angle increasing rapidly without reaching peak — leg extending back
          // This is a short rep — still go to EXTENDING to validate properly
          this.repState = 'EXTENDING';
          debugLog('MTNCLIMB', 'STATE', 'DRIVING → EXTENDING (early reversal)', { angle: +this.smoothedKneeAngle.toFixed(1) });
        }
        break;

      case 'KNEE_AT_CHEST':
        // Track minimum angle
        if (this.smoothedKneeAngle < this.peakKneeAngleDriven) {
          this.peakKneeAngleDriven = this.smoothedKneeAngle;
        }
        // Start extending when angle increases
        if (this.smoothedKneeAngle > this.prevSmoothedKneeAngle + 3) {
          this.repState = 'EXTENDING';
          debugLog('MTNCLIMB', 'STATE', 'KNEE_AT_CHEST → EXTENDING', { peakAngle: +this.peakKneeAngleDriven.toFixed(1) });
        }
        break;

      case 'EXTENDING':
        // Rep complete when angle returns above DRIVE_EXIT_DEG (hysteresis gap above DRIVE_ENTER)
        if (this.smoothedKneeAngle > DRIVE_EXIT_DEG) {
          this.completeRep(now);
          this.repState = 'PLANK';
          // Fix O: reset settle trackers on EXTENDING→PLANK transition
          this.plankSince = now;
          this.plankAngleMin = Infinity;
          this.plankAngleMax = -Infinity;
          this.plankSettledSince = 0;
          this.plankBaselineReseeded = false;
          debugLog('MTNCLIMB', 'STATE', 'EXTENDING → PLANK (rep complete)', { returnAngle: +this.smoothedKneeAngle.toFixed(1) });
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: ballistic check FIRST (before incomplete-drive)
    if (this.repKneeVelocities.length > 0) {
      const peakV = Math.max(...this.repKneeVelocities);
      if (peakV > MAX_KNEE_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    // Fix B: incomplete-drive if knee never reached KNEE_PEAK_DEG
    if (this.peakKneeAngleDriven > KNEE_PEAK_DEG) {
      return { ok: false, reason: 'incomplete-drive' };
    }
    // Too fast
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('MTNCLIMB', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakAngle: +this.peakKneeAngleDriven.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'incomplete-drive') {
        this.maybeEmitWarning('incomplete-drive', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    this.repTimestamps.push(now);
    const pace = this.computePace();

    const smoothness = getSmoothnessScore(this.repKneeVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.peakKneeAngleDriven);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.peakKneeAngleDriven * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      pace,
      warnings: Array.from(this.repWarnings),
    };
    debugLog('MTNCLIMB', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    // Fix O: when not in PLANK, reset baseline continuously
    if (this.repState !== 'PLANK') {
      this.plankSince = now;
      this.plankAngleMin = this.smoothedKneeAngle;
      this.plankAngleMax = this.smoothedKneeAngle;
      this.plankSettledSince = 0;
      this.plankBaselineReseeded = false;
      return;
    }

    if (this.smoothedKneeAngle < this.plankAngleMin) this.plankAngleMin = this.smoothedKneeAngle;
    if (this.smoothedKneeAngle > this.plankAngleMax) this.plankAngleMax = this.smoothedKneeAngle;

    // Fix O: reseed min/max once EMA has settled after a rep
    if (!this.plankBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedKneeAngle - this.prevSmoothedKneeAngle);
      if (emaDelta < 0.3) {
        if (this.plankSettledSince === 0) this.plankSettledSince = now;
        if (now - this.plankSettledSince >= 500) {
          this.plankAngleMin = this.smoothedKneeAngle;
          this.plankAngleMax = this.smoothedKneeAngle;
          this.plankSince = now;
          this.plankBaselineReseeded = true;
        }
      } else {
        this.plankSettledSince = 0;
      }
    }

    const idleMs = now - this.plankSince;
    const variance = this.plankAngleMax - this.plankAngleMin;

    // Fix P: cold-start sentinel — lastNoMovementWarnAt===0 means never fired
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('MTNCLIMB', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        angleVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.plankSince = now;
      this.plankAngleMin = this.smoothedKneeAngle;
      this.plankAngleMax = this.smoothedKneeAngle;
    }
  }

  /** Rolling reps-per-minute from recent rep timestamps. Returns 0 until 2 reps completed. */
  private computePace(): number {
    if (this.repTimestamps.length < 2) return 0;
    const recent = this.repTimestamps.slice(-6);
    let totalInterval = 0;
    for (let i = 1; i < recent.length; i++) {
      totalInterval += recent[i] - recent[i - 1];
    }
    const avgIntervalMs = totalInterval / (recent.length - 1);
    return avgIntervalMs > 0 ? Math.round(60000 / avgIntervalMs) : 0;
  }

  private resetRepBuffers(): void {
    this.peakKneeAngleDriven = 180;
    this.repKneeVelocities = [];
    this.repFormCounts = { hipOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.hipSagFrames = 0;
    this.hipPikeFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('MTNCLIMB', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
