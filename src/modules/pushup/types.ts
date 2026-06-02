import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type PushupRepState = 'TOP' | 'LOWERING' | 'AT_BOTTOM' | 'PUSHING';

export interface PushupBaseline {
  shoulderY: number;
  hipY: number;
  ankleY: number;
  side: 'left' | 'right';
  bodyLength: number;
  noseY: number;
}

export interface PushupRepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface PushupFrameMetrics {
  elbowFlexionDeg: number;
  smoothedFlexionDeg: number;
  repState: PushupRepState;
  hipSagAmount: number;
  hipPikeAmount: number;
  elbowFlared: boolean;
}

export interface PushupEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: PushupRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: PushupFrameMetrics) => void;
}
