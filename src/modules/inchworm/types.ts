import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type InchwormRepState = 'STANDING' | 'FOLDING' | 'AT_BOTTOM' | 'RISING';

/**
 * Baseline captured at calibration — side-camera, person standing upright with
 * arms relaxed at sides.
 */
export interface InchwormBaseline {
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  /** Which side is facing the camera (better visibility score). */
  side: 'left' | 'right';
  /** Vertical body span at calibration (shoulder-to-ankle distance proxy). */
  bodyLengthY: number;
  /** x position of hip at calibration. */
  hipX: number;
  /** x position of shoulder at calibration. */
  shoulderX: number;
}

export interface InchwormRepEvent {
  /** Peak hip hinge angle (degrees) reached this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface InchwormFrameMetrics {
  hipHingeDeg: number;
  smoothedHingeDeg: number;
  repState: InchwormRepState;
}

export interface InchwormEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: InchwormRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: InchwormFrameMetrics) => void;
}
