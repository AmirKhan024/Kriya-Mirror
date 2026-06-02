import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type KBSwingRepState = 'STANDING' | 'HIKE_BACK' | 'AT_BOTTOM' | 'SNAPPING';

/** Baseline captured at calibration — side camera, standing in KB stance. */
export interface KBSwingBaseline {
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  /** Which side is facing the camera (better visibility score). */
  side: 'left' | 'right';
  /** Vertical shoulder-to-ankle span at calibration (distance proxy). */
  bodyLengthY: number;
  hipX: number;
  shoulderX: number;
  /** Knee flexion angle captured at calibration — used to detect squat-pattern deviation. */
  kneeAngleAtCalibration: number;
  /** Wrist Y at calibration — used for arm-lift comparison reference. */
  wristY: number;
}

export interface KBSwingRepEvent {
  /** Peak hip hinge angle (degrees) reached this rep — stored as depthDeg to match shared shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface KBSwingFrameMetrics {
  hipHingeDeg: number;
  smoothedHingeDeg: number;
  repState: KBSwingRepState;
  squatPattern: boolean;
  armLift: boolean;
}

export interface KBSwingEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: KBSwingRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: KBSwingFrameMetrics) => void;
}
