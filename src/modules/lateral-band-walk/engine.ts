/**
 * LateralBandWalkEngine — rep-based step counter for Lateral Band Walk.
 *
 * Detection mechanism: hip X-displacement events (not joint angles).
 * Each STEP_CONFIRMED → STANDING_STILL transition = 1 rep (1 step).
 *
 * State machine:
 *   STANDING_STILL (|displacement| < STEP_ENTER_THRESHOLD)
 *   → STEPPING_OUT (|displacement| > STEP_ENTER_THRESHOLD, timer starts)
 *   → STEP_CONFIRMED (|displacement| > STEP_CONFIRM_THRESHOLD for STEP_MIN_DURATION_MS)
 *   → STANDING_STILL (|displacement| < STEP_RESET_THRESHOLD) → STEP COMPLETE
 *
 * Warnings:
 *   - 'trunk-lean'        — lateral torso lean > 30° during a step (Fix A gated)
 *   - 'hip-drop'          — stepping-side hip drops > 6% torsoHeight (Fix A gated)
 *   - 'steps-not-tracked' — hip near frame edge for 10+ consecutive frames
 *   - 'malformed-rep'     — step velocity > 2.5 OR step duration < 300ms
 *   - 'not-moving'        — 5s idle at STANDING_STILL (Fix I + Fix P + Fix O)
 *   - 'position-lost'     — no usable landmarks ≥ 3s post-cal (Fix N)
 *
 * Fixes applied: A, C, F, G, H, I, J, L, N, O, P
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM,
  lmVisible,
  computeLateralHipDisplacement,
  detectStepDirection,
  computeLateralTrunkLeanDeg,
  detectHipDrop,
  isNearFrameEdge,
  detectForwardWalking,
} from './geometry';
import { LateralBandWalkCalibration } from './calibration';
import type {
  LateralBandWalkBaseline,
  LateralBandWalkEngineCallbacks,
  LateralBandWalkFrameMetrics,
  LateralBandWalkRepEvent,
  LateralBandWalkState,
  StepDirection,
} from './types';
import { computeStepMQS } from './scoring';
import { debugLog } from '@/lib/debug';

// ─── Constants (pre-decided — use verbatim) ──────────────────────────────────

const EMA_ALPHA = 0.25;
// BUG-LBW-01: Raised thresholds above physiological sway range.
// Normal walking sway is 3-8% shoulder width; genuine lateral step is 15-30%.
const STEP_ENTER_THRESHOLD = 0.08;       // was 0.025 — 8% shoulder width (~3.2cm)
const STEP_CONFIRM_THRESHOLD = 0.15;     // was 0.045 — 15% shoulder width (~6cm)
const STEP_RESET_THRESHOLD = 0.04;       // was 0.015 — 4% shoulder width (BUG-LBW-07)
const STEP_MIN_DURATION_MS = 300;
const STEP_MAX_DURATION_MS = 3000;
const STEP_DEBOUNCE_MS = 200;

// BUG-LBW-04: Minimum peak displacement gate — rejects micro-sway false positives.
const MIN_STEP_PEAK_DISPLACEMENT = 0.12; // 12% shoulder width minimum for a valid step

// BUG-LBW-02: Timeout for STEP_CONFIRMED state — prevents indefinite open steps.
const STEP_CONFIRMED_TIMEOUT_MS = 4000;  // max 4s in STEP_CONFIRMED before force-complete

// BUG-LBW-11: Walking gate debounce — number of consecutive frames with ankle Y asymmetry
// that must be observed before an in-progress step is aborted.
// At 30fps, 5 frames = ~167ms. Normal walking swing phase lasts 400–600ms (well above).
// Lateral band walk trailing-foot shuffle (~0–2cm lift) lasts < 100ms (well below).
const WALKING_GATE_DEBOUNCE_FRAMES = 5;

const MAX_HIP_VELOCITY = 2.5;

const TRUNK_LEAN_DEG_THRESHOLD = 30;
const TRUNK_LEAN_DEBOUNCE_FRAMES = 8;
const HIP_DROP_THRESHOLD = 0.08;         // was 0.06 — raised for natural lateral step biomechanics (BUG-LBW-08)
const HIP_DROP_DEBOUNCE_FRAMES = 6;      // BUG-LBW-08: mirrors trunk-lean debounce pattern
const WARNING_REPEAT_COOLDOWN_MS = 2500;

const OUT_OF_FRAME_FRAMES = 10;

// Fix I + P: idle detection
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.008;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N: position lost
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Fix O: post-step EMA reseed
const SETTLED_DELTA_THRESHOLD = 0.003;
const SETTLED_DURATION_MS = 500;

// ─── Engine ──────────────────────────────────────────────────────────────────

export class LateralBandWalkEngine {
  private callbacks: LateralBandWalkEngineCallbacks;
  private calibration: LateralBandWalkCalibration;
  private baseline: LateralBandWalkBaseline | null = null;

  private stepState: LateralBandWalkState = 'STANDING_STILL';
  private stepDirection: StepDirection = null;
  private lastStepDirection: StepDirection = null;

  // EMA-smoothed hip X (absolute, not displaced)
  private smoothedHipX = 0;
  private smoothedHipXInitialized = false;
  private prevSmoothedHipX = 0;

  // Current displacement = smoothedHipX - baseline.hipMid.x, normalized by shoulderWidth
  private smoothedDisplacement = 0;

  private stepStartedAt = 0;
  private lastStepCompletedAt = 0;
  private peakDisplacementThisStep = 0;
  private stepWarnings: Set<WarningType> = new Set();

  private repCount = 0;
  private allWarnings: WarningType[] = [];
  private sessionStartMs = 0;

  // Trunk lean debounce
  private trunkLeanFrames = 0;

  // BUG-LBW-02 + BUG-LBW-06: timestamp when step entered STEP_CONFIRMED state
  private stepConfirmedAt = 0;

  // BUG-LBW-08: hip drop debounce — mirrors trunk-lean pattern
  private hipDropFrames = 0;

  // BUG-LBW-11: walking gate — counts consecutive walking-like ankle frames
  private walkingGateFrames = 0;
  // Set to true once WALKING_GATE_DEBOUNCE_FRAMES consecutive walking frames detected.
  // Causes current step to be silently aborted without emitting malformed-rep.
  private stepHasWalkingViolation = false;

  // Frame-edge tracking
  private nearEdgeFrames = 0;

  // Fix I + O: idle detection
  private standingSince = 0;
  private hipXMin = Infinity;
  private hipXMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  // Fix O: post-step reseed
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: LateralBandWalkEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new LateralBandWalkCalibration();
  }

  update(poses: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(poses, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I + P: initialize idle tracking at calibration confirm
        this.standingSince = now;
        this.hipXMin = 0;
        this.hipXMax = 0;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        this.sessionStartMs = now;
        debugLog('LATERAL-BAND-WALK', 'CALIB', 'CONFIRMED', {
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
          hipMidX: this.baseline ? +this.baseline.hipMid.x.toFixed(3) : null,
        });
      }
      return;
    }

    // Fix N: check position-lost BEFORE the landmark null-return
    this.checkPositionLost(now);

    if (!poses || poses.length === 0) return;
    if (!this.hasCoreLandmarks(poses)) {
      this.lastValidFrameAt = 0;
      return;
    }
    this.lastValidFrameAt = now;

    this.processTrackingFrame(poses, now);
  }

  finish(): void { this.finished = true; }
  resetForNextSet(): void {
    this.stepState = 'STANDING_STILL';
    this.stepDirection = null;
    this.smoothedHipXInitialized = false;
    this.peakDisplacementThisStep = 0;
    this.stepWarnings.clear();
    this.trunkLeanFrames = 0;
    this.hipDropFrames = 0;              // BUG-LBW-08 + BUG-LBW-10
    this.nearEdgeFrames = 0;
    this.stepConfirmedAt = 0;            // BUG-LBW-02 + BUG-LBW-10
    this.walkingGateFrames = 0;          // BUG-LBW-11
    this.stepHasWalkingViolation = false; // BUG-LBW-11
  }

  // ──────────────────────────────────────────────────────────────────────────
  private processTrackingFrame(poses: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh = poses[LM.LEFT_HIP];
    const rh = poses[LM.RIGHT_HIP];
    if (!lh || !rh) return;

    const rawHipX = (lh.x + rh.x) / 2;

    // EMA smooth hip X (B10 pattern: seed from first frame)
    if (!this.smoothedHipXInitialized) {
      this.smoothedHipX = rawHipX;
      this.prevSmoothedHipX = rawHipX;
      this.smoothedHipXInitialized = true;
    } else {
      this.prevSmoothedHipX = this.smoothedHipX;
      this.smoothedHipX = EMA_ALPHA * rawHipX + (1 - EMA_ALPHA) * this.smoothedHipX;
    }

    // Displacement relative to calibrated midpoint, normalized by shoulderWidth
    this.smoothedDisplacement = baseline.shoulderWidth > 0
      ? (this.smoothedHipX - baseline.hipMid.x) / baseline.shoulderWidth
      : (this.smoothedHipX - baseline.hipMid.x);
    const absDisplacement = Math.abs(this.smoothedDisplacement);

    // BUG-LBW-05: Only update direction from frame-delta when STANDING_STILL.
    // During STEPPING_OUT and STEP_CONFIRMED, direction is locked from displacement sign.
    if (this.stepState === 'STANDING_STILL') {
      const frameDir = detectStepDirection(this.smoothedHipX, this.prevSmoothedHipX);
      if (frameDir !== null) {
        this.stepDirection = frameDir;
      }
    }

    // Frame-edge detection (ungated — always check)
    const nearEdge = isNearFrameEdge(rawHipX, 0.08, 0.92);
    if (nearEdge) {
      this.nearEdgeFrames++;
      if (this.nearEdgeFrames >= OUT_OF_FRAME_FRAMES) {
        this.maybeEmitWarning('steps-not-tracked', true, now);
      }
    } else {
      this.nearEdgeFrames = 0;
    }

    // ── State machine ──────────────────────────────────────────────────────
    switch (this.stepState) {
      case 'STANDING_STILL': {
        // Update idle tracking for not-moving detection
        this.checkNoMovement(now);

        if (absDisplacement > STEP_ENTER_THRESHOLD) {
          // BUG-LBW-11: Walking gate — single-frame check at step entry.
          // If ankle Y asymmetry shows one foot is raised, this is forward walking
          // (hip swinging over planted foot with other foot in swing), not a lateral
          // band walk step (both feet on floor). Block entry immediately.
          if (detectForwardWalking(poses)) {
            const la = poses[LM.LEFT_ANKLE];
            const ra = poses[LM.RIGHT_ANKLE];
            debugLog('LATERAL-BAND-WALK', 'GATE', 'walking-detected — blocked step entry', {
              ankleYAsym: la && ra ? +(Math.abs(la.y - ra.y)).toFixed(3) : 'n/a',
              displacement: +this.smoothedDisplacement.toFixed(4),
            });
            break;
          }

          // Fix C: reset BEFORE setting stepStartedAt
          this.resetStepBuffers();
          this.stepStartedAt = now;
          this.stepState = 'STEPPING_OUT';
          // BUG-LBW-05: Always lock direction from displacement sign at step entry.
          // frame-delta direction (updated above) gives only the instantaneous micro-movement;
          // displacement sign from calibrated baseline is the correct directional reference.
          this.stepDirection = this.smoothedDisplacement >= 0 ? 'right' : 'left';
          debugLog('LATERAL-BAND-WALK', 'STATE', 'STANDING_STILL → STEPPING_OUT', {
            displacement: +this.smoothedDisplacement.toFixed(4),
            dir: this.stepDirection,
          });
        }
        break;
      }

      case 'STEPPING_OUT': {
        // BUG-LBW-11: Walking gate — ongoing debounced check during step.
        // If the user is walking (one foot raised for WALKING_GATE_DEBOUNCE_FRAMES consecutive
        // frames), abort the step silently. This catches forward-walking sway that passed the
        // entry gate (e.g., foot was touching down just as displacement entered threshold).
        this.checkWalkingGate(poses);
        if (this.stepHasWalkingViolation) {
          debugLog('LATERAL-BAND-WALK', 'GATE', 'walking-detected — STEPPING_OUT aborted', {
            walkingFrames: this.walkingGateFrames,
          });
          this.stepState = 'STANDING_STILL';
          this.resetStepBuffers();
          this.resetIdleTracking(now);
          break;
        }

        // Fix A: form warnings gated to active step phase
        this.checkFormWarnings(poses, baseline, now);

        // BUG-LBW-03: Track peak ONLY in STEPPING_OUT. Once STEP_CONFIRMED is entered,
        // peak is finalized. Do NOT update peak in STEP_CONFIRMED case.
        if (absDisplacement > this.peakDisplacementThisStep) {
          this.peakDisplacementThisStep = absDisplacement;
        }

        if (absDisplacement > STEP_CONFIRM_THRESHOLD) {
          const elapsed = now - this.stepStartedAt;
          if (elapsed >= STEP_MIN_DURATION_MS) {
            this.stepState = 'STEP_CONFIRMED';
            this.stepConfirmedAt = now; // BUG-LBW-02 + BUG-LBW-06: capture confirm timestamp
            debugLog('LATERAL-BAND-WALK', 'STATE', 'STEPPING_OUT → STEP_CONFIRMED', {
              displacement: +this.smoothedDisplacement.toFixed(4),
              elapsed,
            });
          }
        }

        // Step timed out (wobble, not a real step)
        if (now - this.stepStartedAt > STEP_MAX_DURATION_MS) {
          debugLog('LATERAL-BAND-WALK', 'STATE', 'STEPPING_OUT → STANDING_STILL (timeout)', {});
          this.stepState = 'STANDING_STILL';
          this.resetIdleTracking(now);
        }

        // Displacement dropped back without confirming
        if (absDisplacement < STEP_RESET_THRESHOLD) {
          const elapsed = now - this.stepStartedAt;
          if (elapsed < STEP_MIN_DURATION_MS) {
            // Step was too short — emit malformed-rep
            debugLog('LATERAL-BAND-WALK', 'STEP', 'Rejected: too-fast (aborted)', { elapsed });
            this.maybeEmitWarning('malformed-rep', true, now);
          }
          debugLog('LATERAL-BAND-WALK', 'STATE', 'STEPPING_OUT → STANDING_STILL (reset)', {});
          this.stepState = 'STANDING_STILL';
          this.resetIdleTracking(now);
        }

        break;
      }

      case 'STEP_CONFIRMED': {
        // BUG-LBW-11: Walking gate — continue checking even after confirmation.
        // Handles the edge case where walking was not detected in STEPPING_OUT
        // but becomes clear once the step is held in STEP_CONFIRMED.
        this.checkWalkingGate(poses);
        if (this.stepHasWalkingViolation) {
          debugLog('LATERAL-BAND-WALK', 'GATE', 'walking-detected — STEP_CONFIRMED aborted', {
            walkingFrames: this.walkingGateFrames,
          });
          this.stepState = 'STANDING_STILL';
          this.resetStepBuffers();
          this.resetIdleTracking(now);
          break;
        }

        // Fix A: form warnings still active during confirmed phase
        this.checkFormWarnings(poses, baseline, now);

        // BUG-LBW-03: Peak is NOT tracked here — it was finalized in STEPPING_OUT.

        // Wait for displacement to fall back to reset threshold
        if (absDisplacement < STEP_RESET_THRESHOLD) {
          const elapsed = now - this.stepStartedAt;
          const sinceLastStep = now - this.lastStepCompletedAt;

          // Step debounce: prevent double-counting
          if (sinceLastStep >= STEP_DEBOUNCE_MS) {
            this.completeStep(elapsed, now);
          } else {
            debugLog('LATERAL-BAND-WALK', 'STATE', 'STEP_CONFIRMED → STANDING_STILL (debounced)', {
              sinceLastStep,
            });
          }

          this.stepState = 'STANDING_STILL';

          // Fix O: reset idle tracking after a step
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
          this.resetIdleTracking(now);
          break;
        }

        // BUG-LBW-02: Force-complete if step stays in CONFIRMED beyond timeout.
        // Cap the recorded duration to STEP_MAX_DURATION_MS so artificially long durations
        // don't inflate MQS cadence bonus calculations.
        if (now - this.stepConfirmedAt > STEP_CONFIRMED_TIMEOUT_MS) {
          const cappedElapsed = Math.min(now - this.stepStartedAt, STEP_MAX_DURATION_MS);
          const sinceLastStep = now - this.lastStepCompletedAt;
          debugLog('LATERAL-BAND-WALK', 'STATE', 'STEP_CONFIRMED → STANDING_STILL (timeout)', {
            confirmedElapsed: +(now - this.stepConfirmedAt).toFixed(0),
            cappedElapsed,
          });
          if (sinceLastStep >= STEP_DEBOUNCE_MS) {
            this.completeStep(cappedElapsed, now);
          }
          this.stepState = 'STANDING_STILL';
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
          this.resetIdleTracking(now);
        }

        break;
      }
    }

    // Emit frame metrics
    const trunkLean = computeLateralTrunkLeanDeg(poses);
    const hipDropDetected = detectHipDrop(poses, baseline, this.stepDirection, HIP_DROP_THRESHOLD);
    const frameMetrics: LateralBandWalkFrameMetrics = {
      stepState: this.stepState,
      stepDirection: this.stepDirection,
      smoothedHipXDisplacement: this.smoothedDisplacement,
      trunkLeanDeg: trunkLean,
      hipDropDetected,
      stepCount: this.repCount,
      warningCount: this.allWarnings.length,
      calibrated: true,
      isNearFrameEdge: nearEdge,
    };
    this.callbacks.onFrame?.(frameMetrics);
  }

  // ──────────────────────────────────────────────────────────────────────────
  private completeStep(durationMs: number, now: number): void {
    // Validate step shape
    const validation = this.validateStepShape(durationMs, now);
    if (!validation.ok) {
      debugLog('LATERAL-BAND-WALK', 'STEP', `Rejected: ${validation.reason}`, {
        durationMs,
        peak: +this.peakDisplacementThisStep.toFixed(4),
      });
      this.maybeEmitWarning('malformed-rep', true, now);
      return;
    }

    this.repCount++;
    this.lastStepCompletedAt = now;
    this.lastStepDirection = this.stepDirection;

    const warnings = Array.from(this.stepWarnings);
    for (const w of warnings) this.allWarnings.push(w);

    const mqs = computeStepMQS(warnings, durationMs);

    const event: LateralBandWalkRepEvent = {
      stepDirection: this.stepDirection,
      durationMs,
      peakDisplacement: this.peakDisplacementThisStep,
      mqs,
      warnings,
    };

    debugLog('LATERAL-BAND-WALK', 'STEP', `Step #${this.repCount} complete`, {
      dir: this.stepDirection,
      durationMs,
      peak: +this.peakDisplacementThisStep.toFixed(4),
      mqs,
    });

    this.callbacks.onRepComplete?.(event);
    this.stepWarnings.clear();
  }

  private validateStepShape(durationMs: number, now: number): { ok: boolean; reason?: string } {
    // Too fast: less than min duration
    if (durationMs < STEP_MIN_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }

    // BUG-LBW-04: Minimum peak displacement gate.
    // Rejects micro-sway events (normal walking, balance adjustment) that never reach
    // the displacement magnitude of a genuine lateral band-walk step.
    if (this.peakDisplacementThisStep < MIN_STEP_PEAK_DISPLACEMENT) {
      return { ok: false, reason: 'insufficient-displacement' };
    }

    // BUG-LBW-06: Velocity calculated over time-to-confirm (start → STEP_CONFIRMED),
    // NOT over total elapsed duration which includes the potentially-long STEP_CONFIRMED wait.
    // This correctly catches ballistic fast steps while not penalising slow confirmed steps.
    const dtToConfirm = this.stepConfirmedAt - this.stepStartedAt;
    if (dtToConfirm > 0) {
      const velocity = this.peakDisplacementThisStep / (dtToConfirm / 1000);
      if (velocity > MAX_HIP_VELOCITY) {
        return { ok: false, reason: 'ballistic' };
      }
    }

    return { ok: true };
  }

  // BUG-LBW-11: Walking gate detector.
  // Counts consecutive frames where ankle Y asymmetry indicates one foot is lifted.
  // Once WALKING_GATE_DEBOUNCE_FRAMES consecutive walking frames are seen,
  // sets stepHasWalkingViolation = true so the state machine aborts the step.
  // Uses debounce (not single-frame) to tolerate: brief ankle position jitter,
  // and the trailing-foot micro-lift (~1–2cm, < 3 frames) during a legitimate shuffle.
  private checkWalkingGate(poses: PoseLandmarks): void {
    const isWalking = detectForwardWalking(poses);
    if (isWalking) {
      this.walkingGateFrames++;
      if (this.walkingGateFrames >= WALKING_GATE_DEBOUNCE_FRAMES) {
        this.stepHasWalkingViolation = true;
      }
    } else {
      // Hard reset: once ankle symmetry is restored, reset counter.
      // A legitimate shuffle may have 1–2 walking-like frames but never 5 consecutive.
      this.walkingGateFrames = 0;
    }
  }

  private checkFormWarnings(poses: PoseLandmarks, baseline: LateralBandWalkBaseline, now: number): void {
    // Trunk lean warning (debounced)
    const trunkDeg = computeLateralTrunkLeanDeg(poses);
    if (trunkDeg > TRUNK_LEAN_DEG_THRESHOLD) {
      this.trunkLeanFrames++;
    } else {
      this.trunkLeanFrames = 0;
    }

    if (this.trunkLeanFrames >= TRUNK_LEAN_DEBOUNCE_FRAMES) {
      this.stepWarnings.add('trunk-lean');
      this.maybeEmitWarning('trunk-lean', true, now);
    }

    // BUG-LBW-08: Hip drop warning — now debounced identically to trunk lean.
    // Previous behaviour fired every frame the drop was detected, causing premature
    // warnings during normal lateral-weight-shift biomechanics (beginning of every step).
    const hipDrop = detectHipDrop(poses, baseline, this.stepDirection, HIP_DROP_THRESHOLD);
    if (hipDrop) {
      this.hipDropFrames++;
    } else {
      this.hipDropFrames = 0;
    }

    if (this.hipDropFrames >= HIP_DROP_DEBOUNCE_FRAMES) {
      this.stepWarnings.add('hip-drop');
      this.maybeEmitWarning('hip-drop', true, now);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fix I + P + O: idle (not-moving) detection
  private checkNoMovement(now: number): void {
    // Fix O: do not track idle during a step
    if (this.stepState !== 'STANDING_STILL') {
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }

    const disp = this.smoothedDisplacement;

    // Update min/max for variance check
    if (disp < this.hipXMin) this.hipXMin = disp;
    if (disp > this.hipXMax) this.hipXMax = disp;

    const variance = this.hipXMax - this.hipXMin;

    // Fix O: reseed min/max once EMA has settled (so decay tail doesn't block not-moving)
    if (!this.standingBaselineReseeded) {
      const bl = this.baseline;
      const prevDisp = bl && bl.shoulderWidth > 0
        ? (this.prevSmoothedHipX - bl.hipMid.x) / bl.shoulderWidth
        : 0;
      const delta = Math.abs(disp - prevDisp);
      if (delta < SETTLED_DELTA_THRESHOLD) {
        if (this.standingSettledSince === 0) {
          this.standingSettledSince = now;
        } else if (now - this.standingSettledSince >= SETTLED_DURATION_MS) {
          this.hipXMin = disp;
          this.hipXMax = disp;
          this.standingBaselineReseeded = true;
          debugLog('LATERAL-BAND-WALK', 'IDLE', 'Reseeded hipX min/max', { disp: +disp.toFixed(4) });
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    if (variance >= NO_MOVEMENT_VARIANCE) {
      // User is moving — reset idle timer
      this.standingSince = now;
      return;
    }

    const idleMs = now - this.standingSince;
    if (idleMs >= NO_MOVEMENT_TIMEOUT_MS) {
      // Allow first fire immediately (lastNoMovementWarnAt === 0), repeat after cooldown
      const firstFireAllowed = this.lastNoMovementWarnAt === 0;
      const sinceLastWarn = now - this.lastNoMovementWarnAt;
      if (firstFireAllowed || sinceLastWarn >= NO_MOVEMENT_REPEAT_MS) {
        this.lastNoMovementWarnAt = now;
        debugLog('LATERAL-BAND-WALK', 'WARN', 'not-moving', { idleMs });
        this.callbacks.onPostureWarning?.('not-moving');
        this.warningCooldowns['not-moving'] = now;

        // Fix P: reseed after firing so next period starts fresh
        this.standingSince = now;
        this.hipXMin = disp;
        this.hipXMax = disp;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
      }
    }
  }

  // Fix N: position-lost detection
  private checkPositionLost(now: number): void {
    if (this.lastValidFrameAt === 0) return; // not yet initialized

    const gapMs = now - this.lastValidFrameAt;
    if (gapMs >= POSITION_LOST_TIMEOUT_MS) {
      // Allow first fire immediately (lastPositionLostWarnAt === 0), repeat after cooldown
      const firstFireAllowed = this.lastPositionLostWarnAt === 0;
      const sinceLastWarn = now - this.lastPositionLostWarnAt;
      if (firstFireAllowed || sinceLastWarn >= POSITION_LOST_REPEAT_MS) {
        this.lastPositionLostWarnAt = now;
        debugLog('LATERAL-BAND-WALK', 'WARN', 'position-lost', { gapMs });
        this.callbacks.onPostureWarning?.('position-lost');
      }
    }
  }

  private hasCoreLandmarks(poses: PoseLandmarks): boolean {
    const required = [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
    ];
    return required.every(i => poses[i] != null && lmVisible(poses[i]));
  }

  private resetStepBuffers(): void {
    this.peakDisplacementThisStep = 0;
    this.stepWarnings.clear();
    this.trunkLeanFrames = 0;
    this.hipDropFrames = 0;              // BUG-LBW-08
    this.stepConfirmedAt = 0;            // BUG-LBW-02
    this.walkingGateFrames = 0;          // BUG-LBW-11
    this.stepHasWalkingViolation = false; // BUG-LBW-11
    // BUG-LBW-05: clear direction so next step entry re-locks from displacement sign
    this.stepDirection = null;
  }

  private resetIdleTracking(now: number): void {
    this.standingSince = now;
    this.hipXMin = this.smoothedDisplacement;
    this.hipXMax = this.smoothedDisplacement;
    this.standingSettledSince = 0;
    this.standingBaselineReseeded = false;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type];
    // Allow first fire (last is undefined/0) or after cooldown period
    if (last !== undefined && last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('LATERAL-BAND-WALK', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}

// Re-export geometry helpers for use in tests
export { computeLateralHipDisplacement };
