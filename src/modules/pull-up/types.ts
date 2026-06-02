import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type PullUpRepState = 'HANGING' | 'PULLING' | 'AT_TOP' | 'LOWERING';

/** Pull-up calibration baseline — captures bar height + arm anchor positions. */
export interface PullUpBaseline extends CalibrationBaseline {
  /** Wrist midpoint Y at calibration (= bar height in normalized y). */
  wristMidY: number;
  /** Ear-to-shoulder vertical gap at dead hang: shoulderMidY - earMidY (positive). */
  earShoulderGap: number;
  /** Shoulder-mid X (used for lateral swing / kipping detection). */
  shoulderMidX: number;
  /** Hip-mid X (used for kipping detection). */
  hipMidX: number;
}

export interface PullUpRepEvent {
  /** Peak average elbow flex (degrees) this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface PullUpFrameMetrics {
  elbowFlexionDeg: number;
  smoothedFlexionDeg: number;
  repState: PullUpRepState;
  leftElbowDeg: number;
  rightElbowDeg: number;
  shoulderShrug: boolean;
  kipping: boolean;
}

export interface PullUpEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: PullUpRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: PullUpFrameMetrics) => void;
}
