import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface MountainPoseBaseline {
  /** Reference CoM proxy at the START of the HOLD (first ~30 frames post-cal). */
  comX: number;
  comY: number;
  /** Shoulder width at calibration — normalizes sway + posture deviation. */
  shoulderWidth: number;
  /** Shoulder Y at calibration — used to detect "user stepped away" (hold-broken). */
  shoulderY: number;
}

export interface MountainPoseFrameMetrics {
  /** Smoothed CoM-proxy sway angle in degrees. */
  swayAngleDeg: number;
  swayDisplacement: number;
  /** Smoothed combined posture deviation:
   *   shoulderLevelness + hipLevelness + spineVerticalDeviation
   *  Each component normalized by shoulderWidth. */
  postureDeviation: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface MountainPoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: MountainPoseFrameMetrics) => void;
}
