import type { WarningType } from '@/store/workout';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';

export interface PistolSquatBaseline {
  hipMid: { x: number; y: number };
  shoulderMid: { x: number; y: number };
  hipWidth: number;
  shoulderWidth: number;
  torsoHeight: number;
  ankleY: number;
  feetWidth: number;
  leftKneeX: number;
  rightKneeX: number;
}

export interface PistolSquatFrameMetrics {
  smoothedFlexionDeg: number;
  standingLeg: 'left' | 'right' | null;
  repState: PistolSquatRepState;
  [k: string]: unknown;
}

export interface PistolSquatRepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
  standingLeg: 'left' | 'right';
}

export type PistolSquatRepState = 'STANDING' | 'DESCENDING' | 'AT_BOTTOM' | 'ASCENDING';

export type PistolSquatEngineCallbacks = {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: PistolSquatRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: PistolSquatFrameMetrics) => void;
};

export type { CalibrationBaseline, CalibrationUpdate };
