/**
 * BoxJumpEngine — rep-based tracker for side-camera Box Jump.
 *
 * State machine:
 *   STANDING  (hip.y ≈ baseline, knee angle > 150°)
 *   → LOADING  (hip.y drops past threshold — squat dip detected)
 *   → AIRBORNE (hip Y velocity < -JUMP_VELOCITY_THRESHOLD — explosive upward movement)
 *   → LANDING  (hip Y velocity reverses from negative to positive — descending after peak)
 *   → ABSORBING (knee angle < ABSORB_KNEE_THRESHOLD — absorbing the landing)
 *   → STANDING (hip.y returns within STANDING_TOLERANCE of baseline → REP COMPLETE)
 *
 * Warnings (Fix A–R applied throughout):
 *   - stiff-landing     — knee angle stays > 150° for 300ms after LANDING (gated to active rep, Fix A)
 *   - no-loading        — AIRBORNE entered without prior LOADING state (emitted at rep completion, Fix B)
 *   - incomplete-jump   — max hip rise < MIN_HIP_RISE (emitted at rep completion, Fix B)
 *   - malformed-rep     — jitter spike (peak velocity > MAX_HIP_VELOCITY) or too-short duration
 *   - not-moving        — 5s idle post-calibration (Fix I + Fix P)
 *   - position-lost     — no usable landmarks ≥ 3s post-calibration (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeFlexionDeg } from './geometry';
import { BoxJumpCalibration } from './calibration';
import type { BoxJumpBaseline, BoxJumpEngineCallbacks, BoxJumpFrameMetrics, BoxJumpRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// EMA for hip Y smoothing — higher alpha for explosive movement tracking
const EMA_ALPHA_HIP = 0.25;

// State machine thresholds (normalised Y units, 0..1 frame height)
const LOAD_ENTER_THRESHOLD = 0.04;    // hip.y drop from baseline to enter LOADING
const JUMP_VELOCITY_THRESHOLD = 0.025; // hip Y velocity per frame (normalised/s) — neg = jumping up
const LANDING_VELOCITY_THRESHOLD = 0.015; // hip Y velocity for landing detection (pos = descending)
const STANDING_TOLERANCE = 0.05;      // hip.y must return within this of baseline → rep complete
// kneeFlexionDeg returns 0=straight, 90=quarter-squat, 150=deep squat (it is 180 - included_angle).
// ABSORB_KNEE_THRESHOLD: enter ABSORBING state when knee flexion > 20° (any meaningful bend).
const ABSORB_KNEE_THRESHOLD = 20;     // knee flex > 20° = some bending on landing

// Stiff-landing warning: fire when knee flexion stays < 20° for 300ms after landing.
// A stiff leg (included angle > 160°) has kneeFlexionDeg < 20°.
const STIFF_LANDING_THRESHOLD = 20;   // knee flexion below this = stiff (barely bent)
const STIFF_LANDING_WINDOW_MS = 300;  // how long stiff knee must persist to fire warning

// Rep validation (Fix B, C, D)
const MIN_HIP_RISE = 0.06;            // minimum hip Y displacement (normalised) = real jump
const MIN_REP_DURATION_MS = 600;      // full box jump cycle
// Fix R: MAX_HIP_VELOCITY is intentionally HIGH for box-jump — noise rejection ONLY.
// The velocity stored in repHipVelocities is in normalised Y units per SECOND.
// At 30fps, a real jump moving 0.10 units in 5 frames has peak velocity ~0.60/s.
// A single-frame MediaPipe noise spike would have velocity ~30 units/s (0.10 in one frame).
// We set MAX_HIP_VELOCITY high enough that real jumps are never rejected, but extreme
// spike artefacts are caught. A real jump at 0.10 per frame (30fps) = 3.0/s peak velocity.
// Set to 10.0/s so only true single-frame landmark teleportation artefacts (> 10/s) are caught.
// Tune at physical test if needed.
const MAX_HIP_VELOCITY = 10.0;        // normalised Y units per second. Above this = jitter spike.

// Warning + idle constants
const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.01;    // normalised Y units
const NO_MOVEMENT_REPEAT_MS = 15_000;

// Fix N: position-lost
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class BoxJumpEngine {
  private callbacks: BoxJumpEngineCallbacks;
  private calibration: BoxJumpCalibration;
  private baseline: BoxJumpBaseline | null = null;

  private repState: BoxJumpRepState = 'STANDING';
  private smoothedHipY = 0;
  private prevSmoothedHipY = 0;
  private prevHipY = 0;
  private prevTimestamp = 0;

  // Rep tracking
  private repStartedAt = 0;
  private didLoad = false;           // was LOADING visited before AIRBORNE?
  private maxHipRiseThisRep = 0;    // max upward displacement (normalised Y, positive = rose above baseline)
  private repHipVelocities: number[] = [];
  private repFormCounts = { softLandingCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Stiff-landing debounce (Fix A)
  private stiffLandingFramesSince = 0;  // timestamp when stiff knee sequence started
  private stiffLandingFired = false;    // did we fire it this rep?

  // Idle detection (Fix I + Fix O + Fix P)
  private standingSince = 0;
  private standingHipYMin = Infinity;
  private standingHipYMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position-lost
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: BoxJumpEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new BoxJumpCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I + Fix P: seed idle tracking on cal-confirm
        this.standingSince = now;
        this.standingHipYMin = this.smoothedHipY;
        this.standingHipYMax = this.smoothedHipY;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('BOXJUMP', 'CALIB', 'CONFIRMED', {
            side: this.baseline.side,
            hipY: +this.baseline.hipY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: check position-lost BEFORE the null early-return
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedHipY = 0;
    this.prevSmoothedHipY = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(knee) || !lmVisible(ankle)) return;

    const rawHipY = hip.y;

    // Fix R (EMA init branch): first frame sets value directly (avoids ramping from 0)
    this.smoothedHipY = this.smoothedHipY === 0
      ? rawHipY
      : EMA_ALPHA_HIP * rawHipY + (1 - EMA_ALPHA_HIP) * this.smoothedHipY;

    // Hip Y velocity (normalised Y units per second)
    // Positive = moving down (loading / landing). Negative = moving up (jumping).
    let hipVelocityPerFrame = 0;
    const prevTs = this.prevTimestamp;
    const prevHipY = this.prevHipY;

    if (prevTs > 0) {
      const dt = (now - prevTs) / 1000;
      if (dt > 0) {
        hipVelocityPerFrame = (rawHipY - prevHipY) / dt;
        // Collect velocities during active rep for smoothness scoring
        if (this.repState !== 'STANDING') {
          this.repHipVelocities.push(hipVelocityPerFrame);
        }
      }
    }
    this.prevHipY = rawHipY;
    this.prevTimestamp = now;

    // Hip displacement from baseline: positive = hip dropped below baseline
    const hipDisp = rawHipY - baseline.hipY;

    // Knee flexion angle for landing absorption detection
    const kneeAngle = kneeFlexionDeg(hip, knee, ankle);

    // Max hip rise tracking: negative displacement means hip is above baseline
    const hipRiseAboveBaseline = -(hipDisp); // positive value = rose above baseline
    if (this.repState !== 'STANDING' && hipRiseAboveBaseline > this.maxHipRiseThisRep) {
      this.maxHipRiseThisRep = hipRiseAboveBaseline;
    }

    // Form accumulation during active rep phases
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      // "Soft landing" frame = any knee bend during landing/absorbing phase
      if (kneeAngle > ABSORB_KNEE_THRESHOLD || this.repState === 'ABSORBING') {
        this.repFormCounts.softLandingCount++;
      }
    }

    // Stiff-landing detection (Fix A: gated to active rep)
    // kneeFlexionDeg: 0 = straight leg (stiff), higher = more bent (good absorption)
    // Fire stiff-landing if knee flexion stays BELOW STIFF_LANDING_THRESHOLD for >300ms
    let stiffLanding = false;
    if (inActiveRep && (this.repState === 'LANDING' || this.repState === 'ABSORBING')) {
      if (kneeAngle < STIFF_LANDING_THRESHOLD) {
        if (this.stiffLandingFramesSince === 0) {
          this.stiffLandingFramesSince = now;
        }
        if (now - this.stiffLandingFramesSince >= STIFF_LANDING_WINDOW_MS && !this.stiffLandingFired) {
          stiffLanding = true;
          this.stiffLandingFired = true;
          this.repWarnings.add('stiff-landing');
        }
      } else {
        this.stiffLandingFramesSince = 0;
      }
    }

    // Fix A: gate stiff-landing coaching to active rep
    if (inActiveRep) {
      this.maybeEmitWarning('stiff-landing', stiffLanding, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(hipDisp, hipVelocityPerFrame, kneeAngle, now);

    const metrics: BoxJumpFrameMetrics = {
      hipY: rawHipY,
      smoothedHipY: this.smoothedHipY,
      hipVelocity: hipVelocityPerFrame,
      kneeAngleDeg: kneeAngle,
      repState: this.repState,
      stiffLanding,
    };
    this.callbacks.onFrame?.(metrics);

    this.prevSmoothedHipY = this.smoothedHipY;
  }

  // ----------------------------------------------------------
  private advanceRepState(
    hipDisp: number,
    hipVelocity: number,
    kneeAngle: number,
    now: number,
  ): void {
    switch (this.repState) {
      case 'STANDING':
        // Enter LOADING when hip drops past threshold (positive displacement = dropped)
        if (hipDisp > LOAD_ENTER_THRESHOLD) {
          this.repState = 'LOADING';
          this.didLoad = true;
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.didLoad = true; // restore after resetRepBuffers zeroed it
          this.repStartedAt = now;
          debugLog('BOXJUMP', 'STATE', 'STANDING → LOADING', {
            hipDisp: +hipDisp.toFixed(3),
          });
        }
        break;

      case 'LOADING':
        // Detect explosive jump: hip Y velocity becomes strongly negative (moving up fast)
        if (hipVelocity < -JUMP_VELOCITY_THRESHOLD) {
          this.repState = 'AIRBORNE';
          debugLog('BOXJUMP', 'STATE', 'LOADING → AIRBORNE', {
            velocity: +hipVelocity.toFixed(3),
          });
        }
        // Also enter AIRBORNE if hip rises significantly above baseline without prior velocity signal
        // (handles cases where the loading phase blends into the jump)
        if (hipDisp < -LOAD_ENTER_THRESHOLD) {
          this.repState = 'AIRBORNE';
          debugLog('BOXJUMP', 'STATE', 'LOADING → AIRBORNE (pos)', {
            hipDisp: +hipDisp.toFixed(3),
          });
        }
        break;

      case 'AIRBORNE':
        // Detect LANDING when hip Y velocity reverses to positive (descending after peak)
        // and hip is above or near baseline (hip hasn't hit baseline yet)
        if (hipVelocity > LANDING_VELOCITY_THRESHOLD) {
          this.repState = 'LANDING';
          this.stiffLandingFramesSince = 0;
          this.stiffLandingFired = false;
          debugLog('BOXJUMP', 'STATE', 'AIRBORNE → LANDING', {
            velocity: +hipVelocity.toFixed(3),
            maxRise: +this.maxHipRiseThisRep.toFixed(3),
          });
        }
        break;

      case 'LANDING':
        // Enter ABSORBING when knee bends sufficiently
        if (kneeAngle > ABSORB_KNEE_THRESHOLD) {
          this.repState = 'ABSORBING';
          debugLog('BOXJUMP', 'STATE', 'LANDING → ABSORBING', {
            kneeAngle: +kneeAngle.toFixed(1),
          });
        }
        // Or transition directly to STANDING if hip returns to baseline without absorption
        if (Math.abs(hipDisp) < STANDING_TOLERANCE) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHipYMin = Infinity;
          this.standingHipYMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;

      case 'ABSORBING':
        // Rep complete when hip returns to near baseline height
        if (Math.abs(hipDisp) < STANDING_TOLERANCE) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHipYMin = Infinity;
          this.standingHipYMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  // ----------------------------------------------------------
  /** Per-rep validation (Fix B / Fix D / P1-3: shape checks before timing). */
  private validateRepShape(now: number): {
    ok: boolean;
    reason?: string;
    warnings: WarningType[];
  } {
    const extraWarnings: WarningType[] = [];

    // 1. Jitter spike — single-frame landmark teleportation (Fix D)
    if (this.repHipVelocities.length > 0) {
      const peakVAbs = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakVAbs > MAX_HIP_VELOCITY) {
        return { ok: false, reason: 'ballistic', warnings: [] };
      }
    }

    // 2. Duration gate
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast', warnings: [] };
    }

    // 3. incomplete-jump: hip barely rose → REJECT the rep so a small hop is never
    //    counted as a valid box jump (Fix P1-3 — wrong movement must not count)
    if (this.maxHipRiseThisRep < MIN_HIP_RISE) {
      return { ok: false, reason: 'incomplete-jump', warnings: [] };
    }

    // 4. no-loading: rep counts but gets a form flag (LOADING state never visited)
    if (!this.didLoad) {
      extraWarnings.push('no-loading');
    }

    return { ok: true, warnings: extraWarnings };
  }

  private completeRep(now: number): void {
    const durationMs = this.repStartedAt > 0 ? Math.round(now - this.repStartedAt) : 0;

    // Capture before reset
    const maxRise = this.maxHipRiseThisRep;
    const didLoad = this.didLoad;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      debugLog('BOXJUMP', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        maxRise: +maxRise.toFixed(3),
        durationMs,
        didLoad,
      });
      if (validation.reason === 'incomplete-jump') {
        this.maybeEmitWarning('incomplete-jump', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    // Emit fix-B warnings (no-loading, incomplete-jump) at rep completion
    for (const w of validation.warnings) {
      this.repWarnings.add(w);
      this.maybeEmitWarning(w, true, now);
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(maxRise);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload: {
      depthDeg: number;
      smoothness: number;
      form: number;
      mqs: number;
      warnings: WarningType[];
    } = {
      depthDeg: Math.round(maxRise * 1000) / 1000,  // store as normalised Y displacement
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('BOXJUMP', 'REP', 'Rep complete', {
      ...repPayload,
      durationMs,
      didLoad,
      maxRise: +maxRise.toFixed(3),
    });
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  // Fix I + Fix O + Fix P: idle detection with EMA-decay reseed
  // ----------------------------------------------------------
  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingHipYMin = this.smoothedHipY;
      this.standingHipYMax = this.smoothedHipY;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedHipY < this.standingHipYMin) this.standingHipYMin = this.smoothedHipY;
    if (this.smoothedHipY > this.standingHipYMax) this.standingHipYMax = this.smoothedHipY;

    // Fix O: re-baseline once EMA has settled post-rep (prevents EMA decay tail from blocking not-moving)
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedHipY - this.prevSmoothedHipY);
      if (emaDelta < 0.002) { // ~0.3 in hip Y normalised (smaller scale than knee angle)
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingHipYMin = this.smoothedHipY;
          this.standingHipYMax = this.smoothedHipY;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    const idleMs = now - this.standingSince;
    const variance = this.standingHipYMax - this.standingHipYMin;
    // Fix P: cold-start cooldown — treat lastNoMovementWarnAt === 0 as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('BOXJUMP', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingHipYMin = this.smoothedHipY;
      this.standingHipYMax = this.smoothedHipY;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.repStartedAt = 0;
    this.didLoad = false;
    this.maxHipRiseThisRep = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { softLandingCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.stiffLandingFramesSince = 0;
    this.stiffLandingFired = false;
  }

  // ----------------------------------------------------------
  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('BOXJUMP', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    if (!this.baseline) {
      return lmVisible(landmarks[LM.LEFT_SHOULDER]) || lmVisible(landmarks[LM.RIGHT_SHOULDER]);
    }
    const side = this.baseline.side;
    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    return lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
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
    debugLog('BOXJUMP', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
