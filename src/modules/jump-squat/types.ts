import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type JumpSquatRepState =
  | 'STANDING'
  | 'LOADING'
  | 'AIRBORNE'
  | 'LANDING'
  | 'ABSORBING';

/** Baseline captured at calibration — front camera, standing jump stance. */
export interface JumpSquatBaseline {
  hipY: number;
  shoulderY: number;
  ankleY: number;
  bodyLengthY: number;
  shoulderMid: { x: number; y: number };
  shoulderWidth: number;
  feetWidth: number;
  hipMidX: number;
}

export interface JumpSquatRepEvent {
  /** Max hip upward displacement (normalised Y units) — stored as depthDeg to match shared RepEvent shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface JumpSquatFrameMetrics {
  hipY: number;
  smoothedHipY: number;
  hipVelocity: number;
  kneeAngleDeg: number;
  repState: JumpSquatRepState;
  stiffLanding: boolean;
}

export interface JumpSquatEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: JumpSquatRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: JumpSquatFrameMetrics) => void;
}
