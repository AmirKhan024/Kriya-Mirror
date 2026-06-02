/**
 * PallofPressEngine — hybrid hold-within-rep tracker.
 *
 * Outer loop: 4-state rep machine
 *   HANDS_AT_CHEST → PRESSING_OUT → AT_EXTENDED → RETURNING → HANDS_AT_CHEST
 *
 * Inner hold: accumulatedValidHoldMs counts time at full extension.
 *   Timer freezes (Fix B) when torsoRotationDeg > FORM_FREEZE_THRESHOLD_DEG.
 *   Fix E: debugLog(ENGINE_TAG, 'TIMER', 'frozen'/'resumed', ...) on edges.
 *
 * Emits both onRepComplete (outer rep) and onHoldTick (inner hold timer).
 *
 * Fix N: position-lost after 3s of missing landmarks post-calibration.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible } from '@/modules/squat/geometry';
import { PallofPressCalibration } from './calibration';
import { computeElbowExtensionDeg, computeTorsoRotationDeg, detectShoulderShrug } from './geometry';
import { computeRepMqs } from './scoring';
import type {
  PallofPressState,
  PallofPressBaseline,
  PallofPressFrameMetrics,
  PallofPressRepEvent,
  PallofPressEngineCallbacks,
} from './types';
import { debugLog } from '@/lib/debug';
import type { EngineTag } from '@/lib/debug';

const ENGINE_TAG = 'PALLOF-PRESS' as EngineTag;

// ─── Pre-decided constants (from agent file — do NOT modify) ─────────────────

// State machine thresholds — elbow angle
const EMA_ALPHA = 0.20;
const PRESS_START_DEG = 130;            // elbow > 130° → PRESSING_OUT
const AT_EXTENDED_THRESHOLD_DEG = 145;  // elbow ≥ 145° → AT_EXTENDED candidate
const AT_EXTENDED_STABILITY_FRAMES = 4;
const RETURN_START_DEG = 140;           // elbow < 140° → RETURNING (from AT_EXTENDED)
const AT_CHEST_THRESHOLD_DEG = 115;     // elbow < 115° → HANDS_AT_CHEST (rep done)

// Hold quality
const MIN_HOLD_MS_PER_REP = 1000;       // must hold ≥ 1s at extension to count
const FORM_FREEZE_THRESHOLD_DEG = 8;    // smoothed torso rotation > 8° → freeze hold timer
const EMA_ALPHA_TORSO = 0.25;           // EMA for torso rotation — damps per-frame landmark noise

// Timing
const MIN_REP_DURATION_MS = 2000;
const MAX_REP_DURATION_MS = 20000;

// Posture warnings
const TORSO_ROTATION_WARN_DEG = 8;
const TORSO_ROTATION_DEBOUNCE_FRAMES = 8;
const SHOULDER_SHRUG_THRESHOLD = 0.06;  // shoulders rise > 6% torsoHeight
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix N: position-lost
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Hold-tick interval
const TICK_INTERVAL_MS = 200; // emit onHoldTick every 200ms while at extension

// ─────────────────────────────────────────────────────────────────────────────

export class PallofPressEngine {
  private callbacks: PallofPressEngineCallbacks;
  private calibration: PallofPressCalibration;
  private baseline: PallofPressBaseline | null = null;

  // EMA-smoothed elbow extension angle
  private smoothedElbowDeg = 0;

  // EMA-smoothed torso rotation (absolute value) — prevents per-frame noise from freezing timer.
  // Sentinel -1 means "not yet initialized"; first frame seeds from raw value.
  private smoothedTorsoRotDeg = -1;

  // Current torso rotation for display (set to smoothedTorsoRotDeg each frame)
  private torsoRotationDeg = 0;

  // State machine
  private pressState: PallofPressState = 'HANDS_AT_CHEST';
  private atExtendedFrames = 0;

  // Hold timer (Fix B: "wrong gets discarded")
  private accumulatedValidHoldMs = 0;
  private lastHoldFrameAt: number | null = null;
  private wasTimerFrozen = false;

  // Rotation tracking during hold (for validateRepShape)
  private holdTotalFrames = 0;
  private holdRotationFrames = 0;

  // Rep tracking
  private repStartedAt = 0;
  private repWarnings: Set<WarningType> = new Set();
  private peakElbowDeg = 0;
  private repCount = 0;
  private warningCount = 0;

  // Posture warning debounce
  private torsoRotBadFrames = 0;
  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  // Hold-tick emission throttle
  private lastHoldTickAt = 0;

  // Fix N: position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;
  private calibrated = false;

  private finished = false;

  constructor(callbacks: PallofPressEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new PallofPressCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        this.calibrated = true;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        debugLog(ENGINE_TAG, 'CALIB', 'CONFIRMED', {
          shoulderWidth: +(this.baseline?.shoulderWidth.toFixed(3) ?? 0),
          torsoHeight: +(this.baseline?.torsoHeight.toFixed(3) ?? 0),
        });
      }
      return;
    }

    // Fix N: post-cal position-lost check runs BEFORE landmark-null early return
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.lastValidFrameAt = now;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.pressState = 'HANDS_AT_CHEST';
    this.smoothedElbowDeg = 0;
    this.smoothedTorsoRotDeg = -1;  // reset to sentinel so first rep re-seeds from raw
    this.accumulatedValidHoldMs = 0;
    this.lastHoldFrameAt = null;
    this.wasTimerFrozen = false;
    this.holdTotalFrames = 0;
    this.holdRotationFrames = 0;
    this.atExtendedFrames = 0;
    this.repWarnings = new Set();
    this.peakElbowDeg = 0;
    this.repStartedAt = 0;
    this.torsoRotBadFrames = 0;
  }

  // ---------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    // 1. Compute raw metrics
    const rawElbowDeg = computeElbowExtensionDeg(landmarks);
    const rawRotation = computeTorsoRotationDeg(landmarks, baseline);
    const absTorsoRot = Math.abs(rawRotation);

    // 2. EMA smooth elbow angle
    this.smoothedElbowDeg = this.smoothedElbowDeg === 0
      ? rawElbowDeg
      : EMA_ALPHA * rawElbowDeg + (1 - EMA_ALPHA) * this.smoothedElbowDeg;

    // 2b. EMA smooth torso rotation — the primary fix for hold timer noise.
    // Without this, a 0.01-unit shoulder Y jitter at shoulderWidth=0.081 produces
    // atan2(0.01, 0.081)×57.3 ≈ 7.1°, which constantly crosses the 8° freeze threshold.
    // EMA with α=0.25 suppresses zero-mean noise to ~1.3° RMS while still detecting
    // genuine sustained rotation (12° → crosses 8° threshold in ~4 frames, 133ms).
    if (this.smoothedTorsoRotDeg < 0) {
      // First frame after calibration: seed with raw value instead of applying EMA.
      this.smoothedTorsoRotDeg = absTorsoRot;
    } else {
      this.smoothedTorsoRotDeg =
        EMA_ALPHA_TORSO * absTorsoRot + (1 - EMA_ALPHA_TORSO) * this.smoothedTorsoRotDeg;
    }

    this.torsoRotationDeg = this.smoothedTorsoRotDeg;

    // 3. Peak elbow tracking
    if (this.smoothedElbowDeg > this.peakElbowDeg) {
      this.peakElbowDeg = this.smoothedElbowDeg;
    }

    // 4. Torso rotation warning debounce (Fix A: only when pressing or holding)
    // Uses smoothedTorsoRotDeg — same noise-damping as the freeze logic.
    const inActivePhase = this.pressState !== 'HANDS_AT_CHEST';
    if (inActivePhase && this.smoothedTorsoRotDeg > TORSO_ROTATION_WARN_DEG) {
      this.torsoRotBadFrames++;
      if (this.torsoRotBadFrames >= TORSO_ROTATION_DEBOUNCE_FRAMES) {
        this.maybeEmitWarning('torso-rotation-pallof', true, now);
      }
    } else {
      this.torsoRotBadFrames = 0;
    }

    // 5. Shoulder shrug warning (Fix A: only when pressing or holding)
    if (inActivePhase) {
      const shrugDetected = detectShoulderShrug(landmarks, baseline, SHOULDER_SHRUG_THRESHOLD);
      this.maybeEmitWarning('shoulder-shrug', shrugDetected, now);
    }

    // 6. State machine — pass smoothed rotation; runStateMachine updates wasTimerFrozen
    this.runStateMachine(now, this.smoothedTorsoRotDeg);

    // 7. Emit frame metrics
    // isTimerRunning uses wasTimerFrozen (ground truth from runStateMachine, already updated above).
    const metrics: PallofPressFrameMetrics = {
      pressState: this.pressState,
      smoothedElbowDeg: this.smoothedElbowDeg,
      torsoRotationDeg: this.torsoRotationDeg,
      accumulatedValidHoldMs: this.accumulatedValidHoldMs,
      isTimerRunning: this.pressState === 'AT_EXTENDED' && !this.wasTimerFrozen,
      repCount: this.repCount,
      warningCount: this.warningCount,
      calibrated: this.calibrated,
    };
    this.callbacks.onFrame?.(metrics);
  }

  private runStateMachine(now: number, smoothedTorsoRot: number): void {
    switch (this.pressState) {
      case 'HANDS_AT_CHEST': {
        if (this.smoothedElbowDeg > PRESS_START_DEG) {
          this.pressState = 'PRESSING_OUT';
          this.resetRepBuffers();
          this.repStartedAt = now;  // Fix C: reset FIRST (in resetRepBuffers), set AFTER
          debugLog(ENGINE_TAG, 'STATE', 'HANDS_AT_CHEST → PRESSING_OUT', {
            elbowDeg: +this.smoothedElbowDeg.toFixed(1),
          });
        }
        break;
      }

      case 'PRESSING_OUT': {
        if (this.smoothedElbowDeg >= AT_EXTENDED_THRESHOLD_DEG) {
          this.atExtendedFrames++;
          if (this.atExtendedFrames >= AT_EXTENDED_STABILITY_FRAMES) {
            this.pressState = 'AT_EXTENDED';
            this.lastHoldFrameAt = now;
            this.lastHoldTickAt = now;
            this.smoothedTorsoRotDeg = 0; // reset EMA so hold phase starts clean — no carryover from press-out motion
            debugLog(ENGINE_TAG, 'STATE', 'PRESSING_OUT → AT_EXTENDED', {
              elbowDeg: +this.smoothedElbowDeg.toFixed(1),
            });
          }
        } else {
          this.atExtendedFrames = 0;
        }
        // If they drop back before reaching extended — transition to RETURNING
        if (this.smoothedElbowDeg < AT_CHEST_THRESHOLD_DEG) {
          this.pressState = 'RETURNING';
        }
        break;
      }

      case 'AT_EXTENDED': {
        // Hold timer logic: freeze when smoothed torso rotation exceeds threshold.
        // smoothedTorsoRot (passed from processTrackingFrame) is EMA-filtered (α=0.25),
        // so brief per-frame landmark jitter cannot cross the 8° threshold.
        const timerFrozen = smoothedTorsoRot >= FORM_FREEZE_THRESHOLD_DEG;
        const dtMs = this.lastHoldFrameAt !== null ? now - this.lastHoldFrameAt : 0;
        if (!timerFrozen && dtMs > 0 && dtMs < 500) {
          this.accumulatedValidHoldMs += dtMs;
        }
        this.lastHoldFrameAt = now;

        // Fix E: debug log at freeze/resume edges
        if (timerFrozen !== this.wasTimerFrozen) {
          if (timerFrozen) {
            debugLog(ENGINE_TAG, 'TIMER', 'frozen', {
              reason: 'torso-rotation',
              accumulatedSec: +(this.accumulatedValidHoldMs / 1000).toFixed(2),
            });
          } else {
            debugLog(ENGINE_TAG, 'TIMER', 'resumed', {
              reason: 'torso-rotation-cleared',
              accumulatedSec: +(this.accumulatedValidHoldMs / 1000).toFixed(2),
            });
          }
        }
        this.wasTimerFrozen = timerFrozen;

        // Track rotation stats for validateRepShape
        this.holdTotalFrames++;
        if (smoothedTorsoRot >= FORM_FREEZE_THRESHOLD_DEG) {
          this.holdRotationFrames++;
        }

        // Emit onHoldTick (throttled)
        if (now - this.lastHoldTickAt >= TICK_INTERVAL_MS) {
          this.lastHoldTickAt = now;
          this.callbacks.onHoldTick?.({
            accumulatedMs: this.accumulatedValidHoldMs,
            isTimerRunning: !timerFrozen,
            targetMs: MIN_HOLD_MS_PER_REP,
          });
        }

        // Transition to RETURNING when elbow drops
        if (this.smoothedElbowDeg < RETURN_START_DEG) {
          this.pressState = 'RETURNING';
          debugLog(ENGINE_TAG, 'STATE', 'AT_EXTENDED → RETURNING', {
            elbowDeg: +this.smoothedElbowDeg.toFixed(1),
            holdMs: Math.round(this.accumulatedValidHoldMs),
          });
        }
        break;
      }

      case 'RETURNING': {
        if (this.smoothedElbowDeg < AT_CHEST_THRESHOLD_DEG) {
          this.pressState = 'HANDS_AT_CHEST';
          this.completeRep(now);
        }
        break;
      }
    }
  }

  private completeRep(now: number): void {
    const durationMs = now - this.repStartedAt;
    const warnings = Array.from(this.repWarnings);

    debugLog(ENGINE_TAG, 'REP', 'COMPLETE', {
      durationMs: Math.round(durationMs),
      holdMs: Math.round(this.accumulatedValidHoldMs),
      peakElbowDeg: +this.peakElbowDeg.toFixed(1),
      warnings,
    });

    const result = this.validateRepShape(durationMs);
    if (!result.ok) {
      debugLog(ENGINE_TAG, 'REJECT', result.reason ?? 'unknown', {
        holdMs: Math.round(this.accumulatedValidHoldMs),
        durationMs: Math.round(durationMs),
      });
      if (result.warning) {
        this.repWarnings.add(result.warning);
        this.warningCount++;
        this.callbacks.onPostureWarning?.(result.warning);
      }
      return;
    }

    this.repCount++;
    const mqs = computeRepMqs({
      warnings,
      holdMs: this.accumulatedValidHoldMs,
    });

    const repEvent: PallofPressRepEvent = {
      depthDeg: this.peakElbowDeg,
      smoothness: 100,   // simplified — Pallof is a static hold, smoothness is secondary
      form: mqs,
      mqs,
      holdMs: this.accumulatedValidHoldMs,
      warnings,
    };
    this.callbacks.onRepComplete?.(repEvent);
  }

  /**
   * validateRepShape() — checks in order:
   * 1. Hold too short → 'incomplete-pallof-press'
   * 2. Rotated > 50% of hold time → 'torso-rotation-pallof'
   * 3. Rep too short → 'malformed-rep'
   */
  private validateRepShape(durationMs: number): { ok: boolean; reason?: string; warning?: WarningType } {
    // 1. Hold duration check
    if (this.accumulatedValidHoldMs < MIN_HOLD_MS_PER_REP) {
      return { ok: false, reason: 'hold-too-short', warning: 'incomplete-pallof-press' };
    }

    // 2. Torso rotation during hold — if > 50% of frames were rotating, count it
    if (this.holdTotalFrames > 0) {
      const rotationFraction = this.holdRotationFrames / this.holdTotalFrames;
      if (rotationFraction > 0.50) {
        return { ok: false, reason: 'torso-rotated-majority', warning: 'torso-rotation-pallof' };
      }
    }

    // 3. Rep duration check
    if (durationMs < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast', warning: 'malformed-rep' };
    }

    // Check max duration (ballistic)
    if (durationMs > MAX_REP_DURATION_MS) {
      return { ok: false, reason: 'too-slow', warning: 'malformed-rep' };
    }

    return { ok: true };
  }

  private resetRepBuffers(): void {
    this.accumulatedValidHoldMs = 0;
    this.lastHoldFrameAt = null;
    this.wasTimerFrozen = false;
    this.holdTotalFrames = 0;
    this.holdRotationFrames = 0;
    this.atExtendedFrames = 0;
    this.peakElbowDeg = 0;
    this.repWarnings = new Set();
    this.torsoRotBadFrames = 0;
    this.repStartedAt = 0;  // will be overwritten immediately after
  }

  // ---------------------------------------------------------------------------
  // Fix N: position-lost detection
  // ---------------------------------------------------------------------------

  /** Required core landmarks for valid pallof-press tracking. */
  private hasCoreLandmarks(poses: PoseLandmarks): boolean {
    const required = [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW,    LM.RIGHT_ELBOW,
      LM.LEFT_WRIST,    LM.RIGHT_WRIST,
      LM.LEFT_HIP,      LM.RIGHT_HIP,
    ];
    return required.every(i => {
      const lm = poses[i];
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

  // ---------------------------------------------------------------------------

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    this.repWarnings.add(type);
    this.warningCount++;
    debugLog(ENGINE_TAG, 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
