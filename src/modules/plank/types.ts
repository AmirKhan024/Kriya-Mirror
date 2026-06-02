import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface PlankBaseline {
  /** Average shoulder Y at calibration (used for sag/pike reference) */
  shoulderY: number;
  /** Average hip Y at calibration (the "level line") */
  hipY: number;
  /** Average ankle Y at calibration */
  ankleY: number;
  /** Detected side: 'left' or 'right' (which side faces the camera) */
  side: 'left' | 'right';
  /** Horizontal distance from shoulder to ankle along the body line */
  bodyLength: number;
  /** Nose Y at calibration (for neck-droop reference) */
  noseY: number;
}

export interface PlankFrameMetrics {
  hipSagAmount: number;        // > 0 = sagging below the line
  hipPikeAmount: number;       // > 0 = piked above the line
  spineDeviationDeg: number;   // 0 = perfectly straight
  neckDroopAmount: number;     // > 0 = nose hanging below shoulder
  formScore: number;           // 0–100, smoothed
  isHoldBroken: boolean;
}

export interface PlankEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: PlankFrameMetrics) => void;
}
