/**
 * BroadJumpEngine — rep-based tracker for front-camera Broad Jump.
 *
 * State machine:
 *   STANDING  (hip.y ≈ baseline, knees nearly straight)
 *   → LOADING  (hip.y drops past threshold — squat dip detected)
 *   → AIRBORNE (bilateral hip Y velocity < -JUMP_VELOCITY_THRESHOLD — explosive upward)
 *   → LANDING  (hip Y velocity reverses from negative to positive — descending after peak)
 *   → ABSORBING (knee flexion > ABSORB_KNEE_THRESHOLD — absorbing the landing)
 *   → STANDING (hip.y returns within STANDING_TOLERANCE of baseline → REP COMPLETE)
 *
 * Warnings (Fix A–R applied):
 *   - stiff-landing   — knee stays < 20° flex for 300ms after LANDING (Fix A gated)
 *   - no-loading      — AIRBORNE entered without LOADING visited
 *   - incomplete-jump — max hip rise < MIN_HIP_RISE
 *   - malformed-rep   — jitter spike or too-short duration
 *   - not-moving      — 5s idle post-calibration (Fix I + Fix P)
 *   - position-lost   — no usable landmarks ≥ 3s post-calibration (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, kneeFlexionDeg } from './geometry';
import { BroadJumpCalibration } from './calibration';
import type { BroadJumpBaseline, BroadJumpEngineCallbacks, BroadJumpFrameMetrics, BroadJumpRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// EMA for bilateral hip Y smoothing
const EMA_ALPHA_HIP = 0.25;

// State machine thresholds (normalised Y units, 0..1 frame height)
const LOAD_ENTER_THRESHOLD = 0.03;     // hip.y drop from baseline to enter LOADING
const JUMP_VELOCITY_THRESHOLD = 0.020; // hip Y velocity per second — neg = jumping up
const LANDING_VELOCITY_THRESHOLD = 0.012; // hip Y velocity — pos = descending after peak
const STANDING_TOLERANCE = 0.04;       // hip.y must return within this of baseline → rep complete

// kneeFlexionDeg: 0=straight, increases as knee bends
// ABSORB_KNEE_THRESHOLD: enter ABSORBING when knee flex > 20° (any meaningful bend)
const ABSORB_KNEE_THRESHOLD = 20;

// Stiff-landing: fire when knee flex stays < 20° for 300ms after LANDING
const STIFF_LANDING_THRESHOLD = 20;
const STIFF_LANDING_WINDOW_MS = 300;

// Rep validation
const MIN_HIP_RISE = 0.05;            // minimum hip upward displacement — real jump
const MIN_REP_DURATION_MS = 600;      // full broad jump cycle
// Fix R: MAX_HIP_VELOCITY high — noise rejection only (real jumps never reach this)
const MAX_HIP_VELOCITY = 10.0;

// Warning + idle constants
const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.01;    // normalised Y units
const NO_MOVEMENT_REPEAT_MS = 15_000;

// Fix N: position-lost
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class BroadJumpEngine {
  private callbacks: BroadJumpEngineCallbacks;
  private calibration: BroadJumpCalibration;
  private baseline: BroadJumpBaseline | null = null;

  private repState: BroadJumpRepState = 'STANDING';
  private smoothedHipY = 0;
  private prevSmoothedHipY = 0;
  private prevHipY = 0;
  private prevTimestamp = 0;

  // Rep tracking
  private repStartedAt = 0;
  private didLoad = false;
  private maxHipRiseThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { softLandingCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Stiff-landing debounce (Fix A)
  private stiffLandingFramesSince = 0;
  private stiffLandingFired = false;

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

  constructor(callbacks: BroadJumpEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new BroadJumpCalibration();
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
          debugLog('BROADJUMP', 'CALIB', 'CONFIRMED', {
            hipY: +this.baseline.hipY.toFixed(3),
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
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

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!lmVisible(lh) || !lmVisible(rh) || !lmVisible(lk) || !lmVisible(rk)
      || !lmVisible(la) || !lmVisible(ra)) return;

    const hipMid = midpoint(lh, rh);
    const rawHipY = hipMid.y;

    // Fix R (EMA init branch): first frame sets value directly
    this.smoothedHipY = this.smoothedHipY === 0
      ? rawHipY
      : EMA_ALPHA_HIP * rawHipY + (1 - EMA_ALPHA_HIP) * this.smoothedHipY;

    // Hip Y velocity (normalised Y / second)
    // Positive = moving down (loading / landing). Negative = moving up (jumping).
    let hipVelocityPerFrame = 0;
    if (this.prevTimestamp > 0) {
      const dt = (now - this.prevTimestamp) / 1000;
      if (dt > 0) {
        hipVelocityPerFrame = (rawHipY - this.prevHipY) / dt;
        if (this.repState !== 'STANDING') {
          this.repHipVelocities.push(hipVelocityPerFrame);
        }
      }
    }
    this.prevHipY = rawHipY;
    this.prevTimestamp = now;

    const hipDisp = rawHipY - baseline.hipY;

    // Average bilateral knee flexion for landing absorption
    const leftKneeFlex = kneeFlexionDeg(lh, lk, la);
    const rightKneeFlex = kneeFlexionDeg(rh, rk, ra);
    const kneeAngle = (leftKneeFlex + rightKneeFlex) / 2;

    // Max hip rise tracking
    const hipRiseAboveBaseline = -(hipDisp);
    if (this.repState !== 'STANDING' && hipRiseAboveBaseline > this.maxHipRiseThisRep) {
      this.maxHipRiseThisRep = hipRiseAboveBaseline;
    }

    // Form accumulation
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (kneeAngle > ABSORB_KNEE_THRESHOLD || this.repState === 'ABSORBING') {
        this.repFormCounts.softLandingCount++;
      }
    }

    // Stiff-landing detection (Fix A: gated to active rep)
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

    if (inActiveRep) {
      this.maybeEmitWarning('stiff-landing', stiffLanding, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(hipDisp, hipVelocityPerFrame, kneeAngle, now);

    const metrics: BroadJumpFrameMetrics = {
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
        if (hipDisp > LOAD_ENTER_THRESHOLD) {
          this.repState = 'LOADING';
          this.didLoad = true;
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.didLoad = true;
          this.repStartedAt = now;
          debugLog('BROADJUMP', 'STATE', 'STANDING → LOADING', {
            hipDisp: +hipDisp.toFixed(3),
          });
        }
        break;

      case 'LOADING':
        if (hipVelocity < -JUMP_VELOCITY_THRESHOLD) {
          this.repState = 'AIRBORNE';
          debugLog('BROADJUMP', 'STATE', 'LOADING → AIRBORNE', {
            velocity: +hipVelocity.toFixed(3),
          });
        }
        if (hipDisp < -LOAD_ENTER_THRESHOLD) {
          this.repState = 'AIRBORNE';
          debugLog('BROADJUMP', 'STATE', 'LOADING → AIRBORNE (pos)', {
            hipDisp: +hipDisp.toFixed(3),
          });
        }
        break;

      case 'AIRBORNE':
        if (hipVelocity > LANDING_VELOCITY_THRESHOLD) {
          this.repState = 'LANDING';
          this.stiffLandingFramesSince = 0;
          this.stiffLandingFired = false;
          debugLog('BROADJUMP', 'STATE', 'AIRBORNE → LANDING', {
            velocity: +hipVelocity.toFixed(3),
            maxRise: +this.maxHipRiseThisRep.toFixed(3),
          });
        }
        break;

      case 'LANDING':
        if (kneeAngle > ABSORB_KNEE_THRESHOLD) {
          this.repState = 'ABSORBING';
          debugLog('BROADJUMP', 'STATE', 'LANDING → ABSORBING', {
            kneeAngle: +kneeAngle.toFixed(1),
          });
        }
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

  private validateRepShape(now: number): {
    ok: boolean;
    reason?: string;
    warnings: WarningType[];
  } {
    const extraWarnings: WarningType[] = [];

    // Jitter spike (data unusable — check first)
    if (this.repHipVelocities.length > 0) {
      const peakVAbs = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakVAbs > MAX_HIP_VELOCITY) {
        return { ok: false, reason: 'ballistic', warnings: [] };
      }
    }

    // incomplete-jump before too-fast: if the jump was tiny, "not high enough" is
    // more actionable feedback than "too fast". Mirrors Fix D from bilal_prompt.md.
    if (this.maxHipRiseThisRep < MIN_HIP_RISE) {
      return { ok: false, reason: 'incomplete-jump', warnings: [] };
    }

    // Duration gate
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast', warnings: [] };
    }

    // no-loading: rep counts but gets a form flag
    if (!this.didLoad) {
      extraWarnings.push('no-loading');
    }

    return { ok: true, warnings: extraWarnings };
  }

  private completeRep(now: number): void {
    const durationMs = this.repStartedAt > 0 ? Math.round(now - this.repStartedAt) : 0;
    const maxRise = this.maxHipRiseThisRep;
    const didLoad = this.didLoad;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      debugLog('BROADJUMP', 'REJECT', 'Rep discarded', {
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

    for (const w of validation.warnings) {
      this.repWarnings.add(w);
      this.maybeEmitWarning(w, true, now);
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(maxRise);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(maxRise * 1000) / 1000,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('BROADJUMP', 'REP', 'Rep complete', {
      ...repPayload,
      durationMs,
      didLoad,
      maxRise: +maxRise.toFixed(3),
    });
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  // Fix I + Fix O + Fix P
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

    // Fix O: re-baseline once EMA has settled post-rep
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedHipY - this.prevSmoothedHipY);
      if (emaDelta < 0.002) {
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
    // Fix P: cold-start cooldown
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('BROADJUMP', 'WARN', 'not-moving', {
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

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('BROADJUMP', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE]);
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
    debugLog('BROADJUMP', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
