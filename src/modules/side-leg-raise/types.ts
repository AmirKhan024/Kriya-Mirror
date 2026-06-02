import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 3-state machine — BOTH_DOWN (rest), LEFT_UP, RIGHT_UP (alternating/unilateral
 *  active states). A rep is counted on EXIT from any UP state (the user lowers
 *  the leg, or lifts the other leg). Supports doing all reps on one side OR
 *  alternating. */
export type SideLegRaiseRepState = 'BOTH_DOWN' | 'LEFT_UP' | 'RIGHT_UP';

/** Calibration baseline. Extends the squat-shaped fields and adds per-side
 *  standing abduction references (so lift is measured relative to each leg's
 *  natural standing angle) and the shoulder midpoint X for torso-swing form
 *  tracking. */
export interface SideLegRaiseBaseline extends CalibrationBaseline {
  baselineLeftAbductionDeg: number;
  baselineRightAbductionDeg: number;
  shoulderMidX: number;
}

export interface SideLegRaiseRepEvent {
  /** Peak abduction LIFT this rep, in degrees above the standing baseline. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  /** Which leg abducted — 'left' or 'right'. */
  side: 'left' | 'right';
  warnings: WarningType[];
}

export interface SideLegRaiseFrameMetrics {
  /** Per-side raw abduction lift (degrees above standing baseline). */
  leftAbductionDeg: number;
  rightAbductionDeg: number;
  /** Per-side EMA-smoothed lift — drives the state machine. */
  smoothedLeftLift: number;
  smoothedRightLift: number;
  repState: SideLegRaiseRepState;
  torsoSwing: boolean;
}

export interface SideLegRaiseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: SideLegRaiseRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SideLegRaiseFrameMetrics) => void;
}
