import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type StepUpRepState = 'STANDING' | 'ASCENDING' | 'AT_TOP' | 'DESCENDING';

export interface StepUpBaseline {
  hipY: number;
  shoulderY: number;
  ankleY: number;
  bodyLengthY: number;
  shoulderMid: { x: number; y: number };
  shoulderWidth: number;
  feetWidth: number;
  hipMidX: number;
  leftKneeX: number;
  rightKneeX: number;
}

export interface StepUpRepEvent {
  /** Max hip upward displacement (normalised Y units) — stored as depthDeg to match shared RepEvent shape. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface StepUpFrameMetrics {
  hipY: number;
  smoothedHipY: number;
  hipRise: number;
  repState: StepUpRepState;
  valgusLead: boolean;
  trunkBad: boolean;
}

export interface StepUpEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: StepUpRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: StepUpFrameMetrics) => void;
}
