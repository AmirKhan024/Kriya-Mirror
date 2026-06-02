import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type RDLRepState = 'STANDING' | 'HINGING' | 'AT_BOTTOM' | 'EXTENDING';

/** Baseline captured at calibration — side-camera, standing upright with soft knee bend. */
export interface RDLBaseline {
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
  /** Knee angle (hip-knee-ankle) at calibration — captures the soft bend baseline. */
  kneeAngleAtCalibration: number;
}

export interface RDLRepEvent {
  /** Peak hip hinge angle (degrees) reached this rep — stored as depthDeg. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface RDLFrameMetrics {
  hipHingeDeg: number;
  smoothedHingeDeg: number;
  repState: RDLRepState;
  roundedBack: boolean;
  excessiveKneeBend: boolean;
}

export interface RDLEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: RDLRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: RDLFrameMetrics) => void;
}
