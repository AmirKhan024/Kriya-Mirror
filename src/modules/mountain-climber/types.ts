import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type MountainClimberRepState = 'PLANK' | 'DRIVING' | 'KNEE_AT_CHEST' | 'EXTENDING';

export interface MountainClimberBaseline {
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  wristY: number;
  bodyLengthX: number;       // horizontal length (shoulder.x to ankle.x)
  plankMidpointY: number;   // interpolated Y at hip position for hip-sag reference
  side: 'left' | 'right';
}

export interface MountainClimberRepEvent {
  depthDeg: number;          // peak hip-knee angle (lowest = most driven)
  smoothness: number;
  form: number;
  mqs: number;
  pace: number;              // rolling reps-per-minute (0 until second rep)
  warnings: WarningType[];
}

export interface MountainClimberFrameMetrics {
  kneeHipAngleDeg: number;
  smoothedKneeAngleDeg: number;
  repState: MountainClimberRepState;
  hipSagAmount: number;
  hipPikeAmount: number;
}

export interface MountainClimberEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: MountainClimberRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: MountainClimberFrameMetrics) => void;
}
