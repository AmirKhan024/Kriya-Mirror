import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type BoxJumpRepState =
  | 'STANDING'
  | 'LOADING'
  | 'AIRBORNE'
  | 'LANDING'
  | 'ABSORBING';

/** Baseline captured at calibration — side camera, standing jump stance. */
export interface BoxJumpBaseline {
  hipY: number;
  kneeY: number;
  shoulderY: number;
  ankleY: number;
  side: 'left' | 'right';
  bodyLengthY: number;
  hipX: number;
  shoulderX: number;
  kneeAngleAtCalibration: number;
}

export interface BoxJumpRepEvent {
  /** Hip upward displacement (normalised Y units) — stored as depthDeg to match shared RepEvent shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface BoxJumpFrameMetrics {
  hipY: number;
  smoothedHipY: number;
  hipVelocity: number;
  kneeAngleDeg: number;
  repState: BoxJumpRepState;
  stiffLanding: boolean;
}

export interface BoxJumpEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: BoxJumpRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: BoxJumpFrameMetrics) => void;
}
