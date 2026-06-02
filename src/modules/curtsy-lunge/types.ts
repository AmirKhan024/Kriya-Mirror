import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type CurtsyRepState = 'STANDING' | 'DESCENDING' | 'AT_BOTTOM' | 'ASCENDING';

export interface CurtsyLungeBaseline {
  hipMid: { x: number; y: number };
  shoulderMid: { x: number; y: number };
  hipWidth: number;
  shoulderWidth: number;
  torsoHeight: number;
  ankleY: number;
  leftKneeX: number;
  rightKneeX: number;
  leftAnkleX: number;
  rightAnkleX: number;
}

export interface CurtsyLungeRepEvent {
  /** Front-leg peak knee flexion (degrees, lower = deeper). */
  peakDepthDeg: number;
  /** Which leg was the front (standing) leg this rep. */
  frontLeg: 'left' | 'right';
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface CurtsyLungeFrameMetrics {
  repState: CurtsyRepState;
  smoothedKneeFlexionDeg: number;
  crossoverRatio: number;           // how far rear ankle has crossed behind front (0–1+)
  activeSide: 'left' | 'right' | null;
  trunkLeanDeg: number;
  hipRotationDetected: boolean;
  repCount: number;
  warningCount: number;
  calibrated: boolean;
}

export type CurtsyLungeWarning = Extract<
  WarningType,
  | 'incomplete-curtsy-lunge'
  | 'hip-rotation-curtsy'
  | 'trunk-lean'
  | 'knee-valgus'
  | 'malformed-rep'
  | 'not-moving'
  | 'position-lost'
>;

export interface CurtsyLungeEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: CurtsyLungeRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: CurtsyLungeFrameMetrics) => void;
}
