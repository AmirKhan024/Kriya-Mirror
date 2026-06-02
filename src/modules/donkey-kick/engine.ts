/**
 * DonkeyKickEngine — rep-based tracker for side-camera donkey kick exercise.
 *
 * The person kneels on all fours (quadruped position). Each rep: they kick one
 * leg backward and upward, keeping the knee bent at ~90°, driving the heel
 * toward the ceiling until the thigh is approximately parallel to the floor.
 * The engine tracks thigh lift via the hip→knee vector angle from vertical.
 *
 * Primary metric: smoothedThighLiftDeg = thighLiftDeg(hip, knee).
 *   0° at rest (knee under hip), 80°+ at full kick (thigh horizontal).
 *
 * Active leg: whichever of left/right has the higher thighLiftDeg each frame
 * — unilateral reps are detected automatically.
 *
 * State machine (4-state, mirrors bird-dog):
 *   AT_REST    (rawThighLiftDeg ≤ 10°)
 *   → KICKING  (smoothedThighLiftDeg > 15°)
 *   → AT_TOP   (smoothedThighLiftDeg ≥ 55° for 5 stable frames)
 *   → RETURNING (drops 12° from peak)
 *   → AT_REST  (rawThighLiftDeg < 10°, rep complete)
 *
 * Warnings:
 *   'incomplete-donkey-kick' — peak thighLiftDeg < 45° at rep completion
 *   'malformed-rep'          — too-fast / ballistic / too-slow
 *   'not-moving'             — 5s idle at AT_REST (Fix I + Fix P + Fix O)
 *   'position-lost'          — no usable pose frame for ≥ 3s (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { DonkeyKickCalibration } from './calibration';
import type {
  DonkeyKickBaseline,
  DonkeyKickEngineCallbacks,
  DonkeyKickFrameMetrics,
  DonkeyKickRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { thighLiftDeg as computeThighLiftDeg } from './geometry';
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

const KICK_START_DEG = 15;                // smoothedThighLiftDeg > this → begin KICKING
const AT_TOP_THRESHOLD_DEG = 55;          // smoothedThighLiftDeg >= this → AT_TOP candidate
const AT_TOP_STABILITY_FRAMES = 5;
// RAW threshold for returning to rest — use raw angle (not EMA-smoothed) since
// EMA lag would prevent the smoothed from reaching near-zero in short rep cycles.
const AT_REST_THRESHOLD_RAW = 10;         // rawThighLiftDeg < this → back to AT_REST (RETURNING→AT_REST)
const ASCENT_FROM_PEAK_DEG = 12;          // drop this much from peak → RETURNING
const ASCENDING_DELTA_MIN = 3;

const MIN_REP_DEPTH_DEG = 45;             // peak smoothedThighLiftDeg must exceed this for valid rep
const MIN_REP_DURATION_MS = 500;
const MAX_REP_DURATION_MS = 10000;
const MAX_LIMB_VELOCITY = 2.0;            // ballistic gate (hip-Y velocity proxy)

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle detection (Fix I + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Position-lost detection (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export class DonkeyKickEngine {
  private callbacks: DonkeyKickEngineCallbacks;
  private calibration: DonkeyKickCalibration;
  private baseline: DonkeyKickBaseline | null = null;

  private repState: DonkeyKickRepState = 'AT_REST';
  private smoothedThighLiftDeg = 0;  // EMA of raw thighLiftDeg
  private prevSmoothedThighLiftDeg = 0;
  private rawThighLiftDeg = 0;       // un-smoothed, for AT_REST_THRESHOLD_RAW check
  private peakThighLiftDeg = 0;      // max smoothedThighLiftDeg this rep
  private atTopFrames = 0;           // stability counter for AT_TOP gate
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

  constructor(callbacks: DonkeyKickEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new DonkeyKickCalibration();
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
        this.restAngleMin = this.smoothedThighLiftDeg;
        this.restAngleMax = this.smoothedThighLiftDeg;
        this.restSettledSince = 0;
        this.restBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('DONKEY', 'CALIB', 'CONFIRMED', {
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
    this.smoothedThighLiftDeg = 0;
    this.prevSmoothedThighLiftDeg = 0;
    this.rawThighLiftDeg = 0;
    this.peakThighLiftDeg = 0;
    this.atTopFrames = 0;
    this.activeLeg = null;
    this.resetRepBuffers();
  }

  // ---------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const lh  = landmarks[LEFT_HIP];
    const rh  = landmarks[RIGHT_HIP];
    const lk  = landmarks[LEFT_KNEE];
    const rk  = landmarks[RIGHT_KNEE];
    const ls  = landmarks[LEFT_SHOULDER];
    const rs  = landmarks[RIGHT_SHOULDER];

    // coreOk already checked by hasCoreLandmarks, but guard for type safety
    if (!lmVisible(lh) || !lmVisible(rh) || !lmVisible(lk) || !lmVisible(rk)
        || !lmVisible(ls) || !lmVisible(rs)) {
      return;
    }

    // Active leg: whichever has the larger thighLiftDeg (more kicked)
    const leftLift  = computeThighLiftDeg(lh, lk);
    const rightLift = computeThighLiftDeg(rh, rk);
    const rawThigh  = Math.max(leftLift, rightLift);
    this.rawThighLiftDeg = rawThigh;
    this.activeLeg = leftLift >= rightLift ? 'left' : 'right';

    // EMA smoothing — seed with first real value
    this.smoothedThighLiftDeg = this.smoothedThighLiftDeg === 0
      ? rawThigh
      : EMA_ALPHA * rawThigh + (1 - EMA_ALPHA) * this.smoothedThighLiftDeg;

    // Hip Y velocity — use average of both hips (body translates as a unit)
    const avgHipY = (lh.y + rh.y) / 2;
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (avgHipY - this.prevHipY) / dt;
        if (this.repState === 'KICKING' || this.repState === 'AT_TOP' || this.repState === 'RETURNING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = avgHipY;
    this.prevHipTimestamp = now;

    // Form accumulation during active phases
    const inActiveRep = this.repState !== 'AT_REST';
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      // All frames count as good form (no specific form metric for donkey kick in 2D side view)
      this.repFormCounts.hipOKCount++;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: DonkeyKickFrameMetrics = {
      thighLiftDeg: rawThigh,
      smoothedThighLiftDeg: this.smoothedThighLiftDeg,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedThighLiftDeg = this.smoothedThighLiftDeg;
  }

  // ---------------------------------------------------------------------------
  // Donkey Kick uses a 4-state machine with an AT_TOP stability gate.
  // The stability gate ensures we don't flip into RETURNING on a brief dip.
  // ---------------------------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'AT_REST':
        if (this.smoothedThighLiftDeg > KICK_START_DEG) {
          this.repState = 'KICKING';
          // Fix C: reset FIRST, then set repStartedAt (resetRepBuffers zeros it)
          this.resetRepBuffers();
          this.repStartedAt = now;
          this.atTopFrames = 0;
          debugLog('DONKEY', 'STATE', 'AT_REST → KICKING', {
            thigh: +this.smoothedThighLiftDeg.toFixed(1),
          });
        }
        break;

      case 'KICKING': {
        this.peakThighLiftDeg = Math.max(this.peakThighLiftDeg, this.smoothedThighLiftDeg);
        // Check for AT_TOP stability gate
        if (this.smoothedThighLiftDeg >= AT_TOP_THRESHOLD_DEG) {
          this.atTopFrames++;
          if (this.atTopFrames >= AT_TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('DONKEY', 'STATE', 'KICKING → AT_TOP', {
              peak: +this.peakThighLiftDeg.toFixed(1),
              frames: this.atTopFrames,
            });
          }
        } else {
          // Not yet at threshold — detect reversal from peak
          const prevThigh = this.prevSmoothedThighLiftDeg;
          const deltaDown = this.smoothedThighLiftDeg - prevThigh;
          const dropFromPeak = this.peakThighLiftDeg - this.smoothedThighLiftDeg;
          if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || deltaDown < -ASCENDING_DELTA_MIN) {
            this.repState = 'RETURNING';
            debugLog('DONKEY', 'STATE', 'KICKING → RETURNING (below threshold)', {
              peak: +this.peakThighLiftDeg.toFixed(1),
              dropFromPeak: +dropFromPeak.toFixed(1),
            });
          }
        }
        break;
      }

      case 'AT_TOP': {
        this.peakThighLiftDeg = Math.max(this.peakThighLiftDeg, this.smoothedThighLiftDeg);
        const prevThigh = this.prevSmoothedThighLiftDeg;
        const deltaDown = this.smoothedThighLiftDeg - prevThigh;
        const dropFromPeak = this.peakThighLiftDeg - this.smoothedThighLiftDeg;
        // Detect reversal: thighLiftDeg dropped ASCENT_FROM_PEAK_DEG from peak, or clearly descending.
        if (dropFromPeak >= ASCENT_FROM_PEAK_DEG || deltaDown < -ASCENDING_DELTA_MIN) {
          this.repState = 'RETURNING';
          debugLog('DONKEY', 'STATE', 'AT_TOP → RETURNING', {
            peak: +this.peakThighLiftDeg.toFixed(1),
            dropFromPeak: +dropFromPeak.toFixed(1),
          });
        }
        break;
      }

      case 'RETURNING':
        // Use RAW thighLiftDeg (not EMA-smoothed) for the return-to-rest check.
        // EMA lag would prevent the smoothed from reaching near-zero in normal
        // rep cycles, causing reps to never complete.
        if (this.rawThighLiftDeg < AT_REST_THRESHOLD_RAW) {
          this.completeRep(now);
          this.repState = 'AT_REST';
          this.atTopFrames = 0;
          // Reset EMA to current raw value so the next rep starts from an
          // accurate baseline. Without this, EMA lag keeps smoothedThighLiftDeg
          // elevated, which immediately re-triggers KICKING and produces a
          // spurious too-shallow rejection warning.
          this.smoothedThighLiftDeg     = this.rawThighLiftDeg;
          this.prevSmoothedThighLiftDeg = this.rawThighLiftDeg;
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
    if (this.peakThighLiftDeg < MIN_REP_DEPTH_DEG) {
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
      debugLog('DONKEY', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakThighLiftDeg: +this.peakThighLiftDeg.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-donkey-kick' as WarningType, true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness  = getSmoothnessScore(this.repHipVelocities);
    const form        = getFormScore(this.repFormCounts);
    const completion  = getCompletionScore(this.peakThighLiftDeg);
    const mqs         = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg:   Math.round(this.peakThighLiftDeg * 10) / 10,
      smoothness: Math.round(smoothness),
      form:       Math.round(form),
      mqs:        Math.round(mqs),
      warnings:   Array.from(this.repWarnings),
    };
    debugLog('DONKEY', 'REP', 'Rep complete', repPayload);
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
      this.restAngleMin = this.smoothedThighLiftDeg;
      this.restAngleMax = this.smoothedThighLiftDeg;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
      return;
    }

    if (this.smoothedThighLiftDeg < this.restAngleMin) this.restAngleMin = this.smoothedThighLiftDeg;
    if (this.smoothedThighLiftDeg > this.restAngleMax) this.restAngleMax = this.smoothedThighLiftDeg;

    // Fix O: re-baseline once the post-rep EMA decay has settled (< 0.3°/frame
    // for 500 ms), so the decay tail doesn't permanently inflate min-max and
    // prevent the not-moving warning from ever firing.
    if (!this.restBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedThighLiftDeg - this.prevSmoothedThighLiftDeg);
      if (emaDelta < 0.3) {
        if (this.restSettledSince === 0) this.restSettledSince = now;
        if (now - this.restSettledSince >= 500) {
          this.restAngleMin = this.smoothedThighLiftDeg;
          this.restAngleMax = this.smoothedThighLiftDeg;
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
      debugLog('DONKEY', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        angleVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.restSince = now;
      this.restAngleMin = this.smoothedThighLiftDeg;
      this.restAngleMax = this.smoothedThighLiftDeg;
      this.restSettledSince = 0;
      this.restBaselineReseeded = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Fix N: position-lost detection
  // ---------------------------------------------------------------------------

  /** Uses dominant-side landmarks for core visibility check. */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const side = this.baseline?.side ?? 'left';
    return side === 'left'
      ? lmVisible(landmarks[LEFT_HIP])
        && lmVisible(landmarks[LEFT_KNEE])
        && lmVisible(landmarks[LEFT_ANKLE])
        && lmVisible(landmarks[LEFT_SHOULDER])
      : lmVisible(landmarks[RIGHT_HIP])
        && lmVisible(landmarks[RIGHT_KNEE])
        && lmVisible(landmarks[RIGHT_ANKLE])
        && lmVisible(landmarks[RIGHT_SHOULDER]);
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
    debugLog('DONKEY', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ---------------------------------------------------------------------------
  private resetRepBuffers(): void {
    this.peakThighLiftDeg   = 0;
    this.repHipVelocities   = [];
    this.repFormCounts      = { hipOKCount: 0, totalCount: 0 };
    this.repWarnings        = new Set();
    this.repStartedAt       = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('DONKEY', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
