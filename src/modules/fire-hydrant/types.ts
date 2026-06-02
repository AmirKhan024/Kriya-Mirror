import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type FireHydrantRepState = 'AT_REST' | 'LIFTING' | 'AT_TOP' | 'RETURNING';

export interface FireHydrantBaseline {
  side: 'left' | 'right';
  bodyLength: number;
  hipY: number;
  shoulderY: number;
  ankleY: number;
}

export interface FireHydrantRepEvent {
  /** Peak thighLiftDeg for this rep (stored as depthDeg for shared RepEvent shape). */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface FireHydrantFrameMetrics {
  thighLiftDeg: number;
  smoothedThighLiftDeg: number;
  repState: FireHydrantRepState;
}

export interface FireHydrantEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: FireHydrantRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: FireHydrantFrameMetrics) => void;
}

export type { CalibrationUpdate };
