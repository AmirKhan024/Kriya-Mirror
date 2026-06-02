import type { WarningType } from '@/store/workout';

export type BurpeeRepState =
  | 'STANDING'
  | 'SQUATTING'
  | 'PLANK'
  | 'RISING'
  | 'JUMPING';

export interface BurpeeBaseline {
  /** Hip Y at calibration (standing baseline). All phase thresholds derived from this. */
  hipY: number;
  kneeY: number;
  shoulderY: number;
  ankleY: number;
  side: 'left' | 'right';
  /** Body height (shoulder Y to ankle Y) at calibration — used for distance gate. */
  bodyLengthY: number;
  hipX: number;
  shoulderX: number;
  /** Knee angle at calibration (should be ~170° standing). */
  kneeAngleAtCalibration: number;
  /** Derived threshold: hipY + PLANK_ENTER. Hip must drop below this to enter PLANK. */
  plankHipYThreshold: number;
  /** Derived threshold: hipY - JUMP_ENTER_THRESHOLD. Hip must rise above this (smaller Y) to enter JUMPING. */
  jumpHipYThreshold: number;
}

export interface BurpeeFrameMetrics {
  hipYOffset: number;
  smoothedHipYOffset: number;
  repState: BurpeeRepState;
  kneeAngleDeg: number;
  hipSag: number;
}

export interface BurpeeRepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface BurpeeEngineCallbacks {
  onCalibrationUpdate?: (update: import('@/modules/squat/types').CalibrationUpdate) => void;
  onRepComplete?: (rep: BurpeeRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: BurpeeFrameMetrics) => void;
}
