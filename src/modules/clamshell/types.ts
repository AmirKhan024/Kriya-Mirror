import type { WarningType } from '@/store/workout';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';

export interface ClamshellBaseline {
  // Shared calibration baseline fields (adapter-compatible):
  hipMid: { x: number; y: number };
  shoulderMid: { x: number; y: number };
  hipWidth: number;
  shoulderWidth: number;
  torsoHeight: number;
  ankleY: number;
  feetWidth: number;
  leftKneeX: number;
  rightKneeX: number;
  // Clamshell-specific:
  bottomSide: 'left' | 'right';
  topSide: 'left' | 'right';
  bottomHipY: number;
  topHipY: number;
  bottomKneeY: number;
  topKneeY: number;
  hipGap: number;            // abs(bottomHipY - topHipY) — normalization reference
  kneeGapBaseline: number;   // (bottomKneeY - topKneeY) at closed position
}

export interface ClamshellFrameMetrics {
  smoothedAbductionFrac: number;
  repState: ClamshellRepState;
  [k: string]: unknown;
}

export interface ClamshellRepEvent {
  peakOpenFrac: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export type ClamshellRepState = 'CLOSED' | 'OPENING' | 'AT_OPEN' | 'CLOSING';

export type ClamshellEngineCallbacks = {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: ClamshellRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ClamshellFrameMetrics) => void;
};

export type { CalibrationBaseline, CalibrationUpdate };
