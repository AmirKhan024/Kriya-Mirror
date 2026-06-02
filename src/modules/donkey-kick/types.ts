import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type DonkeyKickRepState = 'AT_REST' | 'KICKING' | 'AT_TOP' | 'RETURNING';

export interface DonkeyKickBaseline {
  side: 'left' | 'right';
  bodyLength: number;
  hipY: number;
  shoulderY: number;
  ankleY: number;
}

export interface DonkeyKickRepEvent {
  /** Peak thighLiftDeg for this rep (stored as depthDeg for shared RepEvent shape). */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface DonkeyKickFrameMetrics {
  thighLiftDeg: number;
  smoothedThighLiftDeg: number;
  repState: DonkeyKickRepState;
}

export interface DonkeyKickEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: DonkeyKickRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: DonkeyKickFrameMetrics) => void;
}

export type { CalibrationUpdate };
