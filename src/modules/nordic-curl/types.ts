import type { WarningType } from '@/store/workout';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';

export interface NordicCurlBaseline {
  activeSide: 'left' | 'right';  // which side's landmarks we're tracking
  hipX: number;    // hip landmark X at rest
  hipY: number;    // hip landmark Y at rest
  shoulderX: number;
  shoulderY: number;
  torsoHeight: number;   // abs(shoulderY - hipY) — normalization reference
  kneeY: number;         // knee Y at calibration
  ankleY: number;        // ankle Y at calibration
}

export interface NordicCurlFrameMetrics {
  smoothedTrunkLeanDeg: number;
  repState: NordicCurlRepState;
  [k: string]: unknown;
}

export interface NordicCurlRepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export type NordicCurlRepState = 'TALL' | 'DESCENDING' | 'AT_BOTTOM' | 'ASCENDING';

export type NordicCurlEngineCallbacks = {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: NordicCurlRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: NordicCurlFrameMetrics) => void;
};

export type { CalibrationBaseline, CalibrationUpdate };
