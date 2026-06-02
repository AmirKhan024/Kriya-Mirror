/**
 * BurpeeEngine — side-facing camera, rep-based multi-phase tracker.
 *
 * State machine (driven by hip Y position):
 *   STANDING  → SQUATTING (hip drops > SQUAT_ENTER from baseline)
 *   SQUATTING → PLANK     (hip drops > PLANK_ENTER from baseline AND knee angle > PLANK_KNEE_THRESHOLD)
 *   PLANK     → RISING    (hip Y starts decreasing — user pushing back up)
 *   RISING    → JUMPING   (hip Y rises ABOVE standing baseline — airborne)
 *   JUMPING   → STANDING  (hip Y returns within STANDING_TOLERANCE of baseline — rep complete)
 *
 * Primary metric: smoothed hip Y position.
 * Secondary metric: knee angle to distinguish SQUAT from PLANK.
 *
 * All fixes A–R applied.
 */

import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeExtensionDeg, hipPlankDeviationFromLine, hipYOffset } from './geometry';
import { BurpeeCalibration } from './calibration';
import type { BurpeeBaseline, BurpeeEngineCallbacks, BurpeeFrameMetrics, BurpeeRepState } from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMA_ALPHA_HIP = 0.20;   // medium-fast tracking for burpee

const SQUAT_ENTER = 0.04;     // hip Y drop from baseline → enter SQUATTING
const SQUAT_EXIT = 0.02;      // hysteresis — must rise this much to return to STANDING from SQUATTING

const PLANK_ENTER = 0.14;     // hip Y drop → enter PLANK (much lower than squat)
const PLANK_EXIT = 0.10;      // hysteresis
const PLANK_KNEE_THRESHOLD = 145; // knee extension must be > this in PLANK (horizontal body)

const JUMP_ENTER_THRESHOLD = 0.015; // hip Y above baseline = airborne (EMA-smoothed threshold)
const STANDING_TOLERANCE = 0.05;    // hip Y return tolerance after jump

const HIP_SAG_THRESHOLD = 0.04;     // deviation from plank body line

const MIN_REP_DURATION_MS = 800;    // EMA lag means a valid rep measures ~1s even for 1.4s cycles
const MAX_HIP_VELOCITY = 0.15;      // Fix R: noise rejection (not ballistic rejection for jump)

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.01;     // smoothedHipY varies < this = idle
const NO_MOVEMENT_REPEAT_MS = 15_000;

const POSITION_LOST_TIMEOUT_MS = 3000; // Fix N
const POSITION_LOST_REPEAT_MS = 10_000;

// ─── Engine ───────────────────────────────────────────────────────────────────

export class BurpeeEngine {
  private callbacks: BurpeeEngineCallbacks;
  private calibration: BurpeeCalibration;
  private baseline: BurpeeBaseline | null = null;

  private repState: BurpeeRepState = 'STANDING';

  // EMA-smoothed hip Y (absolute position in frame)
  private smoothedHipY = 0;
  private prevSmoothedHipY = 0;

  // Hip Y velocity tracking
  private prevHipY = 0;
  private prevTimestamp = 0;
  private repHipVelocities: number[] = [];

  // Rep tracking
  private repStartedAt = 0;
  private maxHipYDropThisRep = 0;   // max (hipY - baseline.hipY) during rep = how deep user went
  private visitedPlank = false;
  private visitedJump = false;
  private risingNearStandingFrames = 0; // debounce for RISING→STANDING no-jump
  private repFormCounts = { hipSagOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();

  // Idle detection (Fix I, Fix O, Fix P)
  private standingSince = 0;
  private standingHipYMin = Infinity;
  private standingHipYMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private standingSettledSince = 0;        // Fix O
  private standingBaselineReseeded = false; // Fix O

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: BurpeeEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new BurpeeCalibration();
  }

  // ─── ExerciseEngine interface ─────────────────────────────────────────────

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I: seed idle tracking on cal-confirm
        this.standingSince = now;
        this.standingHipYMin = this.smoothedHipY;
        this.standingHipYMax = this.smoothedHipY;
        this.standingSettledSince = 0;          // Fix O
        this.standingBaselineReseeded = false;  // Fix O
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('BURPEE', 'CALIB', 'CONFIRMED', {
            hipY: +this.baseline.hipY.toFixed(3),
            plankThresh: +this.baseline.plankHipYThreshold.toFixed(3),
            jumpThresh: +this.baseline.jumpHipYThreshold.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs BEFORE the null-frame guard
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

  // ─── Core tracking ────────────────────────────────────────────────────────

  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    // Pick visible-side landmarks
    const side = baseline.side;
    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    // For hip Y we use the visible-side hip (side camera)
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const coreOk = lmVisible(lh) && lmVisible(rh)
      && lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE]);
    if (!coreOk) return;

    const rawHipY = hip.y;

    // EMA smoothing (Fix R: first-frame init)
    this.smoothedHipY = this.smoothedHipY === 0
      ? rawHipY
      : EMA_ALPHA_HIP * rawHipY + (1 - EMA_ALPHA_HIP) * this.smoothedHipY;

    // Hip Y velocity tracking
    if (this.prevTimestamp > 0) {
      const dt = (now - this.prevTimestamp) / 1000;
      if (dt > 0) {
        const v = (rawHipY - this.prevHipY) / dt;
        if (this.repState !== 'STANDING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = rawHipY;
    this.prevTimestamp = now;

    // Knee extension angle (used to distinguish squat from plank)
    const kneeExt = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle)
      ? kneeExtensionDeg(hip, knee, ankle)
      : 170; // assume standing if not visible

    // Hip Y offset from standing baseline (positive = dropped)
    const offset = hipYOffset(this.smoothedHipY, baseline.hipY);

    // Track max drop for completion scoring
    if (this.repState !== 'STANDING') {
      this.maxHipYDropThisRep = Math.max(this.maxHipYDropThisRep, offset);
    }

    // Hip-sag in PLANK phase (line-relative metric, Fix B9 from known-issues)
    // Guard: only compute when body is actually horizontal (shoulder ≈ ankle Y).
    // When the pose stub switches back to vertical layout during rising, shoulder.y ≈ 0.26
    // and ankle.y ≈ 0.88 — skipping prevents a false hip-sag fire on that transition frame.
    let hipSag = 0;
    const bodyIsHorizontal = Math.abs(shoulder.y - ankle.y) < 0.15;
    if (this.repState === 'PLANK' && bodyIsHorizontal && lmVisible(shoulder) && lmVisible(hip) && lmVisible(ankle)) {
      hipSag = hipPlankDeviationFromLine(shoulder.y, hip.y, ankle.y);
    }

    // Form accumulation during PLANK phase
    if (this.repState === 'PLANK') {
      this.repFormCounts.totalCount++;
      if (hipSag < HIP_SAG_THRESHOLD) this.repFormCounts.hipSagOKCount++;
    }

    // Warning: hip-sag during active rep (Fix A: gated to active rep)
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep && this.repState === 'PLANK') {
      this.maybeEmitWarning('hip-sag', hipSag >= HIP_SAG_THRESHOLD, now);
    }

    // No-movement detection
    this.checkNoMovement(now);

    // State machine
    this.advanceRepState(offset, kneeExt, now);

    // Per-frame callback
    const frameMetrics: BurpeeFrameMetrics = {
      hipYOffset: offset,
      smoothedHipYOffset: hipYOffset(this.smoothedHipY, baseline.hipY),
      repState: this.repState,
      kneeAngleDeg: kneeExt,
      hipSag,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedHipY = this.smoothedHipY;
  }

  // ─── State machine ────────────────────────────────────────────────────────

  private advanceRepState(offset: number, kneeExt: number, now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (offset > SQUAT_ENTER) {
          this.repState = 'SQUATTING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('BURPEE', 'STATE', 'STANDING → SQUATTING', { offset: +offset.toFixed(3) });
        }
        break;

      case 'SQUATTING':
        // Transition to PLANK: hip dropped enough AND knee is extended (horizontal body)
        if (offset > PLANK_ENTER && kneeExt > PLANK_KNEE_THRESHOLD) {
          this.repState = 'PLANK';
          this.visitedPlank = true;
          debugLog('BURPEE', 'STATE', 'SQUATTING → PLANK', {
            offset: +offset.toFixed(3),
            kneeExt: +kneeExt.toFixed(1),
          });
        }
        // Back to STANDING if user barely moved and returned
        else if (offset < SQUAT_EXIT && this.repStartedAt > 0) {
          // Incomplete — call completeRep so validateRepShape fires incomplete-plank warning
          debugLog('BURPEE', 'STATE', 'SQUATTING → STANDING (aborted)', { offset: +offset.toFixed(3) });
          this.completeRep(now); // visitedPlank=false → incomplete-plank warning fires
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHipYMin = Infinity;
          this.standingHipYMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;

      case 'PLANK':
        // Transition to RISING: hip Y starts decreasing (user pushing back up)
        if (offset < PLANK_EXIT) {
          this.repState = 'RISING';
          debugLog('BURPEE', 'STATE', 'PLANK → RISING', { offset: +offset.toFixed(3) });
        }
        break;

      case 'RISING':
        // Transition to JUMPING: hip Y rises ABOVE standing baseline
        if (offset < -JUMP_ENTER_THRESHOLD) {
          this.risingNearStandingFrames = 0;
          this.repState = 'JUMPING';
          this.visitedJump = true;
          debugLog('BURPEE', 'STATE', 'RISING → JUMPING', { offset: +offset.toFixed(3) });
        }
        // Transition to STANDING without jump: user stood back up without jumping.
        // Require 5 consecutive frames near baseline to avoid EMA pass-through false fires.
        else if (offset < SQUAT_EXIT && offset > -JUMP_ENTER_THRESHOLD) {
          this.risingNearStandingFrames++;
          if (this.risingNearStandingFrames >= 5) {
            debugLog('BURPEE', 'STATE', 'RISING → STANDING (no jump)', { offset: +offset.toFixed(3) });
            this.completeRep(now); // visitedJump=false → fires no-jump warning
            this.repState = 'STANDING';
            this.standingSince = now;
            this.standingHipYMin = Infinity;
            this.standingHipYMax = -Infinity;
            this.standingSettledSince = 0;
            this.standingBaselineReseeded = false;
          }
        } else {
          this.risingNearStandingFrames = 0;
        }
        break;

      case 'JUMPING':
        // Transition to STANDING: hip Y returns within standing tolerance
        if (Math.abs(offset) < STANDING_TOLERANCE) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingHipYMin = Infinity;
          this.standingHipYMax = -Infinity;
          this.standingSettledSince = 0;       // Fix O reset site 3
          this.standingBaselineReseeded = false; // Fix O reset site 3
          debugLog('BURPEE', 'STATE', 'JUMPING → STANDING (rep done)');
        }
        break;
    }
  }

  // ─── Rep completion ───────────────────────────────────────────────────────

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;

    // Fix D: jitter spike check FIRST
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      // Note: MAX_HIP_VELOCITY here is for NOISE REJECTION only (not for jump detection)
      // Very fast overall noise, not the jump itself (which causes large negative velocity)
      // We check the VARIANCE-based metric but skip rejecting the jump-phase velocities
      // since large velocity is expected/desired in a burpee.
      if (peakV > MAX_HIP_VELOCITY * 10) {
        // Only reject if absurdly high (> 1.5/s) — this catches data glitches, not real jumps
        return { ok: false, reason: 'ballistic-noise' };
      }
    }

    // Fix B: incomplete-plank check
    if (!this.visitedPlank) {
      return { ok: false, reason: 'incomplete-plank' };
    }

    // Fix B: no-jump check
    if (!this.visitedJump) {
      return { ok: false, reason: 'no-jump' };
    }

    // Fix B: duration check
    if (durationMs < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }

    return { ok: true };
  }

  private completeRep(now: number): void {
    const durationMs = this.repStartedAt > 0 ? Math.round(now - this.repStartedAt) : 0;
    const validation = this.validateRepShape(now);

    if (!validation.ok) {
      debugLog('BURPEE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        durationMs,
        visitedPlank: this.visitedPlank,
        visitedJump: this.visitedJump,
        maxDrop: +this.maxHipYDropThisRep.toFixed(3),
      });
      if (validation.reason === 'incomplete-plank') {
        this.maybeEmitWarning('incomplete-plank', true, now);
      } else if (validation.reason === 'no-jump') {
        this.maybeEmitWarning('no-jump', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxHipYDropThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxHipYDropThisRep * 1000) / 10, // convert to a "depth" metric
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };

    debugLog('BURPEE', 'REP', 'Rep complete', { ...repPayload, durationMs });
    this.callbacks.onRepComplete?.(repPayload);
    this.resetRepBuffers();
  }

  // ─── Idle detection (Fix I, Fix O, Fix P) ─────────────────────────────────

  private checkNoMovement(now: number): void {
    // Fix O reset site 2: when not in STANDING, reset idle tracking
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

    // Fix O: re-baseline once EMA has settled after rep
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedHipY - this.prevSmoothedHipY);
      if (emaDelta < 0.002) { // small delta threshold for hip Y (different unit from flexion degrees)
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

    // Fix P: cold-start sentinel
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;

    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('BURPEE', 'WARN', 'not-moving', {
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

  // ─── Position-lost (Fix N) ────────────────────────────────────────────────

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE])
      && lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER]);
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
    debugLog('BURPEE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (last !== 0 && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('BURPEE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
    if (this.repState !== 'STANDING') {
      this.repWarnings.add(type);
    }
  }

  private resetRepBuffers(): void {
    this.maxHipYDropThisRep = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { hipSagOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.visitedPlank = false;
    this.visitedJump = false;
    this.risingNearStandingFrames = 0;
  }
}
