import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type StarJumpRepState = 'DOWN' | 'RAISING' | 'AT_TOP' | 'LOWERING';

export interface StarJumpBaseline extends CalibrationBaseline {
  /** Baseline shoulder midpoint X (for torso-swing detection). */
  shoulderMidX: number;
}

export interface StarJumpRepEvent {
  /** Peak wristDelta × 100 (range 0–30 at typical overhead position). */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface StarJumpFrameMetrics {
  wristDelta: number;
  smoothedWristDelta: number;
  repState: StarJumpRepState;
  leftWristDelta: number;
  rightWristDelta: number;
  legSpreadRatio: number;
  torsoSwing: boolean;
}

export interface StarJumpEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: StarJumpRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: StarJumpFrameMetrics) => void;
}
