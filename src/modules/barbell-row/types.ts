import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type RowRepState = 'HANGING' | 'ROWING' | 'AT_ROW_TOP' | 'LOWERING';

/** Baseline captured at calibration — side-camera, bent-over ~45° working position. */
export interface RowBaseline {
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  hipHingeDegAtCal: number;
  /** Which side is facing the camera (better visibility score). */
  side: 'left' | 'right';
  /** Vertical shoulder-to-ankle span in frame at calibration (distance proxy). */
  bodyLengthY: number;
  /** x position of shoulder at calibration. */
  shoulderX: number;
  /** x position of hip at calibration. */
  hipX: number;
}

export interface RowRepEvent {
  /** Peak elbow flexion angle (degrees) reached this rep — stored as depthDeg to match shared RepRecord shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface RowFrameMetrics {
  elbowFlexionDeg: number;
  smoothedFlexionDeg: number;
  repState: RowRepState;
  roundedBack: boolean;
  hipSway: boolean;
}

export interface RowEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: RowRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: RowFrameMetrics) => void;
}
