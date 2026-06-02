import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type BroadJumpRepState =
  | 'STANDING'
  | 'LOADING'
  | 'AIRBORNE'
  | 'LANDING'
  | 'ABSORBING';

/** Baseline captured at calibration — front camera, standing jump stance. */
export interface BroadJumpBaseline {
  hipY: number;
  shoulderY: number;
  ankleY: number;
  bodyLengthY: number;
  shoulderMid: { x: number; y: number };
  shoulderWidth: number;
  feetWidth: number;
  hipMidX: number;
}

export interface BroadJumpRepEvent {
  /** Max hip upward displacement (normalised Y units) — stored as depthDeg to match shared RepEvent shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface BroadJumpFrameMetrics {
  hipY: number;
  smoothedHipY: number;
  hipVelocity: number;
  kneeAngleDeg: number;
  repState: BroadJumpRepState;
  stiffLanding: boolean;
}

export interface BroadJumpEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: BroadJumpRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: BroadJumpFrameMetrics) => void;
}
