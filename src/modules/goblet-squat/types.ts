import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

// Goblet squat uses exactly the same rep states as squat
export type GobletSquatRepState = 'STANDING' | 'DESCENDING' | 'AT_BOTTOM' | 'ASCENDING';

// Baseline is identical to squat — no extra fields needed
export type GobletSquatBaseline = CalibrationBaseline;

export interface GobletSquatRepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface GobletSquatFrameMetrics {
  smoothedFlexionDeg: number;
  elbowSpreadRatio: number;
  repState: GobletSquatRepState;
}

export interface GobletSquatEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: GobletSquatRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: GobletSquatFrameMetrics) => void;
}

export type { CalibrationUpdate, CalibrationBaseline };
