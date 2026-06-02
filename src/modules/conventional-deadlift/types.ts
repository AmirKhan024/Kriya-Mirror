import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type DeadliftRepState = 'STANDING' | 'HINGING' | 'AT_BOTTOM' | 'EXTENDING';

/** Baseline captured at calibration — side-camera, standing upright. */
export interface DeadliftBaseline {
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  /** Which side is facing the camera (better visibility score). */
  side: 'left' | 'right';
  /** Horizontal shoulder-to-ankle span in frame at calibration (distance proxy). */
  bodyLengthY: number;
  /** x position of hip at calibration — used for forward-lean reference. */
  hipX: number;
  /** x position of shoulder at calibration — reference for hyperextension check. */
  shoulderX: number;
}

export interface DeadliftRepEvent {
  /** Peak hip hinge angle (degrees) reached this rep — stored as depthDeg to match shared RepRecord shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface DeadliftFrameMetrics {
  hipHingeDeg: number;
  smoothedHingeDeg: number;
  repState: DeadliftRepState;
  roundedBack: boolean;
  hipsShootingUp: boolean;
}

export interface DeadliftEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: DeadliftRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: DeadliftFrameMetrics) => void;
}
