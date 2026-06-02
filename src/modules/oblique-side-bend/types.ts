import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 3-state machine — UPRIGHT (rest), LEFT_BENT, RIGHT_BENT. A rep is counted on
 *  EXIT from a bent state (return to upright, or bend the other way). Supports
 *  all-one-side or alternating bends. */
export type SideBendRepState = 'UPRIGHT' | 'LEFT_BENT' | 'RIGHT_BENT';

/** Calibration baseline. Extends the squat-shaped fields and adds the per-side
 *  standing lean references (the natural upright lean, ~0°) and the shoulder
 *  midpoint X. */
export interface SideBendBaseline extends CalibrationBaseline {
  baselineLeftLeanDeg: number;
  baselineRightLeanDeg: number;
  shoulderMidX: number;
}

export interface SideBendRepEvent {
  /** Peak lateral lean LIFT this rep, in degrees above the standing baseline. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  /** Which way the torso bent — 'left' or 'right'. */
  side: 'left' | 'right';
  warnings: WarningType[];
}

export interface SideBendFrameMetrics {
  /** Per-direction raw lean lift (degrees above standing baseline). */
  leftLeanDeg: number;
  rightLeanDeg: number;
  /** Per-direction EMA-smoothed lift — drives the state machine. */
  smoothedLeftLift: number;
  smoothedRightLift: number;
  repState: SideBendRepState;
}

export interface SideBendEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: SideBendRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SideBendFrameMetrics) => void;
}
