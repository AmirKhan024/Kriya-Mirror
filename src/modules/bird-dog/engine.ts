/**
 * BirdDogEngine — rep-based tracker for side-camera bird-dog exercise.
 *
 * The person kneels on all fours (quadruped position). Each rep: they extend
 * one leg backward (and opposite arm forward), hold briefly, then return.
 * The engine tracks leg extension via the hip-knee-ankle angle.
 *
 * Primary metric: smoothedExtension = max(0, hipKneeAnkleDeg - 90).
 *   0° at rest (knee under hip), 70°+ at full extension (leg horizontal).
 *
 * Active leg: whichever of left/right has the higher hip-knee-ankle angle
 * each frame — unilateral reps are detected automatically.
 *
 * State machine (4-state, mirrors dead-bug):
 *   AT_REST      (ext ≤ 8° raw)
 *   → EXTENDING  (smoothedExt > 20°)
 *   → AT_EXTENDED (smoothedExt ≥ 50° for 5 stable frames)
 *   → RETURNING  (ext drops 12° from peak, or -3°/frame)
 *   → AT_REST    (rawExt < 8°, rep complete)
 *
 * Warnings:
 *   'incomplete-bird-dog' — peak smoothedExtension < 45° at rep completion
 *   'malformed-rep'       — too-fast / ballistic / too-slow
 *   'not-moving'          — 5s idle at AT_REST (Fix I + Fix P + Fix O)
 *   'position-lost'       — no usable pose frame for ≥ 3s (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { BirdDogCalibration } from './calibration';
import type {
  BirdDogBaseline,
  BirdDogEngineCallbacks,
  BirdDogFrameMetrics,
  BirdDogRepState,
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
// Tunable constants (verbatim from spec)
// ---------------------------------------------------------------------------
const EMA_ALPHA = 0.15;

const EXTEND_START_DEG = 20;           // smoothedExtension > this → begin EXTENDING
const AT_EXTENDED_THRESHOLD_DEG = 50;  // smoothedExtension >= this → AT_EXTENDED candidate
const AT_EXTENDED_STABILITY_FRAMES = 5;
// RAW threshold for returning to rest — use raw angle (not EMA-smoothed) since
// EMA lag would prevent the smoothed from reaching near-zero in short rep cycles.
const AT_REST_THRESHOLD_RAW = 8;       // rawExtension < this → back to AT_REST (RETURNING→AT_REST)
const ASCENT_FROM_PEAK_DEG = 12;       // drop this much from peak → RETURNING
const ASCENDING_DELTA_MIN = 3;

const MIN_REP_DEPTH_DEG = 45;          // peak smoothedExtension must exceed this for valid rep
const MIN_REP_DURATION_MS = 600;
const MAX_REP_DURATION_MS = 10000;
const MAX_LIMB_VELOCITY = 2.0;         // ballistic gate (hip-Y velocity proxy)

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle detection (Fix I + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

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
export class BirdDogEngine {
  private callbacks: BirdDogEngineCallbacks;
  private calibration: BirdDogCalibration;
  private baseline: BirdDogBaseline | null = null;

  private repState: BirdDogRepState = 'AT_REST';
  private smoothedAngle = 0;       // EMA of raw max(leftAngle, rightAngle)
  private prevSmoothedAngle = 0;
  private smoothedExtension = 0;   // max(0, smoothedAngle - 90)
  private rawAngle = 0;            // current raw angle (stored for EMA reset on AT_REST entry)
  private rawExtension = 0;        // un-smoothed, for AT_REST_THRESHOLD_RAW check
  private maxExtensionThisRep = 0;
  private atExtendedFrames = 0;    // stability counter for AT_EXTENDED gate
  private repHipVelocities: number[] = [];
  private repFormCounts = { hipOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;
  private activeLeg: 'left' | 'right' | null = null;

  private repStartedAt = 0;

  // Idle detection (Fix I + Fix P)
  private restSince = 0;
  private restAngleMin = Infinity;
  private restAngleMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  // Fix O: EMA reseed after post-rep decay settles
  private restSettledSince = 0;
  private restBaselineReseeded = false;

  // Fix N: position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: BirdDogEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new BirdDogCalibration();
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
          debugLog('BIRD-DOG', 'CALIB', 'CONFIRMED', {
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
    this.atExtendedFrames = 0;
    this.activeLeg = null;
    this.resetRepBuffers();
  }

  // ---------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
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
    this.activeLeg   = leftAngle >= rightAngle ? 'left' : 'right';

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
        if (this.repState === 'EXTENDING' || this.repState === 'AT_EXTENDED' || this.repState === 'RETURNING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = avgHipY;
    this.prevHipTimestamp = now;

    // Form accumulation during active phases (no hip-lift for bird-dog)
    const inActiveRep = this.repState !== 'AT_REST';
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      // All frames count as good form (no specific form metric for bird-dog in 2D side view)
      this.repFormCounts.hipOKCount++;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: BirdDogFrameMetrics = {
      kneeAngleDeg: rawAngle,
      smoothedExtensionDeg: this.smoothedExtension,
      repState: this.repState,
      activeLeg: this.activeLeg,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedAngle = this.smoothedAngle;
  }

  // ---------------------------------------------------------------------------
  // Bird-Dog uses a 4-state machine with an AT_EXTENDED stability gate.
  // The stability gate ensures we don't flip into RETURNING on a brief dip.
  // ---------------------------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'AT_REST':
        if (this.smoothedExtension > EXTEND_START_DEG) {
          this.repState = 'EXTENDING';
          // Fix C: reset FIRST, then set repStartedAt (resetRepBuffers zeros it)
          this.resetRepBuffers();
          this.repStartedAt = now;
          this.atExtendedFrames = 0;
          debugLog('BIRD-DOG', 'STATE', 'AT_REST → EXTENDING', {
            ext: +this.smoothedExtension.toFixed(1),
          });
        }
        break;

      case 'EXTENDING': {
        this.maxExtensionThisRep = Math.max(this.maxExtensionThisRep, this.smoothedExtension);
        // Check for AT_EXTENDED stability gate
        if (this.smoothedExtension >= AT_EXTENDED_THRESHOLD_DEG) {
          this.atExtendedFrames++;
          if (this.atExtendedFrames >= AT_EXTENDED_STABILITY_FRAMES) {
            this.repState = 'AT_EXTENDED';
            debugLog('BIRD-DOG', 'STATE', 'EXTENDING → AT_EXTENDED', {
              peak: +this.maxExtensionThisRep.toFixed(1),
              frames: this.atExtendedFrames,
            });
          }
        } else {
          // Not yet at threshold — detect reversal from peak
          const prevExt = Math.max(0, this.prevSmoothedAngle - 90);
          const deltaDown = this.smoothedExtension - prevExt;
          const dropFromPeak = this.maxExtensionThisRep - this.smoothedExtension;
          if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || deltaDown < -ASCENDING_DELTA_MIN) {
            this.repState = 'RETURNING';
            debugLog('BIRD-DOG', 'STATE', 'EXTENDING → RETURNING (below threshold)', {
              peak: +this.maxExtensionThisRep.toFixed(1),
              dropFromPeak: +dropFromPeak.toFixed(1),
            });
          }
        }
        break;
      }

      case 'AT_EXTENDED': {
        this.maxExtensionThisRep = Math.max(this.maxExtensionThisRep, this.smoothedExtension);
        const prevExt = Math.max(0, this.prevSmoothedAngle - 90);
        const deltaDown = this.smoothedExtension - prevExt;
        const dropFromPeak = this.maxExtensionThisRep - this.smoothedExtension;
        // Detect reversal: extension dropped ASCENT_FROM_PEAK_DEG from peak, or clearly descending.
        if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || deltaDown < -ASCENDING_DELTA_MIN) {
          this.repState = 'RETURNING';
          debugLog('BIRD-DOG', 'STATE', 'AT_EXTENDED → RETURNING', {
            peak: +this.maxExtensionThisRep.toFixed(1),
            dropFromPeak: +dropFromPeak.toFixed(1),
          });
        }
        break;
      }

      case 'RETURNING':
        // Use RAW extension (not EMA-smoothed) for the return-to-rest check.
        // EMA lag would prevent the smoothed from reaching near-zero in normal
        // 1–2 second rep cycles, causing reps to never complete.
        if (this.rawExtension < AT_REST_THRESHOLD_RAW) {
          this.completeRep(now);
          this.repState = 'AT_REST';
          this.atExtendedFrames = 0;
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
      if (peakV > MAX_LIMB_VELOCITY) return { ok: false, reason: 'ballistic' };
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
      debugLog('BIRD-DOG', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakExtension: +this.maxExtensionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-bird-dog' as WarningType, true, now);
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
    debugLog('BIRD-DOG', 'REP', 'Rep complete', repPayload);
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

    // Cold-start fix (Fix P): treat lastNoMovementWarnAt === 0 as "never fired", so
    // the first warning fires even when now < NO_MOVEMENT_REPEAT_MS.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS && variance < NO_MOVEMENT_VARIANCE_DEG && firstFireAllowed) {
      this.lastNoMovementWarnAt = now;
      debugLog('BIRD-DOG', 'WARN', 'not-moving', {
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
    debugLog('BIRD-DOG', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ---------------------------------------------------------------------------
  private resetRepBuffers(): void {
    this.maxExtensionThisRep = 0;
    this.repHipVelocities    = [];
    this.repFormCounts       = { hipOKCount: 0, totalCount: 0 };
    this.repWarnings         = new Set();
    this.repStartedAt        = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('BIRD-DOG', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
