import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type WalkingLungeRepState = 'STANDING' | 'DESCENDING' | 'AT_BOTTOM' | 'ASCENDING';

/** Baseline measurements captured at calibration (feet-together, arms-at-sides). */
export interface WalkingLungeBaseline {
  shoulderMid: { x: number; y: number };
  hipMid: { x: number; y: number };
  shoulderWidth: number;
  hipWidth: number;
  ankleY: number;            // average ankle y (floor reference)
  feetWidth: number;          // x-distance between ankles at calibration
  leftKneeX: number;
  rightKneeX: number;
}

export interface WalkingLungeRepEvent {
  /** Front-leg peak knee flexion (degrees). */
  depthDeg: number;
  /** Which leg was the front leg this rep. */
  frontLeg: 'left' | 'right';
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface WalkingLungeFrameMetrics {
  /** Live front-leg knee flexion (raw). */
  kneeFlexionDeg: number;
  /** EMA-smoothed front-leg flex. */
  smoothedFlexionDeg: number;
  /** Which leg the engine currently considers the front leg (during a rep). */
  frontLeg: 'left' | 'right' | null;
  repState: WalkingLungeRepState;
  trunkLeanDeg: number;
  valgusFront: boolean;
  trunkBad: boolean;
}

export interface WalkingLungeEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: WalkingLungeRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: WalkingLungeFrameMetrics) => void;
}
