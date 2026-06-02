import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type LateralBandWalkState =
  | 'STANDING_STILL'
  | 'STEPPING_OUT'
  | 'STEP_CONFIRMED';

export type StepDirection = 'left' | 'right' | null;

export interface LateralBandWalkBaseline {
  hipMid: { x: number; y: number };
  shoulderMid: { x: number; y: number };
  hipWidth: number;
  shoulderWidth: number;
  torsoHeight: number;
  ankleY: number;
  leftHipY: number;
  rightHipY: number;
  frameWidth: number;
}

export interface LateralBandWalkRepEvent {
  /** Which direction this step went. */
  stepDirection: StepDirection;
  /** Step duration in ms. */
  durationMs: number;
  /** Hip displacement at confirmation (normalized to body width). */
  peakDisplacement: number;
  mqs: number;
  warnings: WarningType[];
}

export interface LateralBandWalkFrameMetrics {
  stepState: LateralBandWalkState;
  stepDirection: StepDirection;
  smoothedHipXDisplacement: number;
  trunkLeanDeg: number;
  hipDropDetected: boolean;
  stepCount: number;           // total steps = repCount
  warningCount: number;
  calibrated: boolean;
  isNearFrameEdge: boolean;    // hint for UI: user approaching edge
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type LateralBandWalkWarning = Extract<
  WarningType,
  | 'trunk-lean'
  | 'hip-drop'
  | 'steps-not-tracked'
  | 'malformed-rep'
  | 'not-moving'
  | 'position-lost'
>;

export interface LateralBandWalkEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: LateralBandWalkRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: LateralBandWalkFrameMetrics) => void;
}
