import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type ReverseFlyRepState = 'DOWN' | 'RAISING' | 'AT_TOP' | 'LOWERING';

export interface ReverseFlyBaseline {
  shoulderMidX: number;
  shoulderMidY: number;
  leftShoulderX: number;
  rightShoulderX: number;
  hipMidY: number;
  bodyHeight: number;
  wristRestL: number;
  wristRestR: number;
}

export interface ReverseFlyRepEvent {
  depthDeg: number;       // bilateral average peak armLiftDeg (for RepEvent.depthDeg)
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface ReverseFlyFrameMetrics {
  smoothedLiftL: number;
  smoothedLiftR: number;
  smoothedLift: number;   // bilateral average
  repState: ReverseFlyRepState;
}

export interface ReverseFlyEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: ReverseFlyRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ReverseFlyFrameMetrics) => void;
}

export type { CalibrationUpdate };
