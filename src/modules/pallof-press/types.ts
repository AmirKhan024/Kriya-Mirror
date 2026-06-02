import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type PallofPressState =
  | 'HANDS_AT_CHEST'
  | 'PRESSING_OUT'
  | 'AT_EXTENDED'
  | 'RETURNING';

export interface PallofPressBaseline {
  hipMid: { x: number; y: number };
  shoulderMid: { x: number; y: number };
  shoulderWidth: number;
  hipWidth: number;
  torsoHeight: number;
  leftShoulderY: number;
  rightShoulderY: number;
  leftElbowX: number;
  rightElbowX: number;
  ankleY: number;
}

export interface PallofPressFrameMetrics {
  pressState: PallofPressState;
  smoothedElbowDeg: number;         // arm extension angle
  torsoRotationDeg: number;         // deviation from calibrated square baseline
  accumulatedValidHoldMs: number;
  isTimerRunning: boolean;
  repCount: number;
  warningCount: number;
  calibrated: boolean;
}

export type PallofPressWarning = Extract<
  WarningType,
  | 'incomplete-pallof-press'
  | 'torso-rotation-pallof'
  | 'shoulder-shrug'
  | 'malformed-rep'
  | 'position-lost'
>;

export interface PallofPressRepEvent {
  depthDeg: number;       // peak elbow extension angle this rep
  smoothness: number;     // 0–100 form smoothness
  form: number;           // 0–100 form quality
  mqs: number;            // movement quality score
  holdMs: number;         // accumulated valid hold ms this rep
  warnings: WarningType[];
}

export interface PallofPressEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: PallofPressRepEvent) => void;
  onHoldTick?: (tick: { accumulatedMs: number; isTimerRunning: boolean; targetMs: number }) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: PallofPressFrameMetrics) => void;
}
