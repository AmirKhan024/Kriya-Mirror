import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type ShrugRepState = 'STANDING' | 'SHRUGGING' | 'AT_TOP' | 'LOWERING';

/** Extends squat's calibration baseline with shrug-specific shoulder anchors. */
export interface ShrugBaseline extends CalibrationBaseline {
  /** Baseline shoulder Y midpoint — used for elevation detection. */
  shoulderMidY: number;
  /** Baseline shoulder X midpoint — used for torso-swing detection. */
  shoulderMidX: number;
  /** Baseline hip X midpoint — used for torso-swing detection. */
  hipMidX: number;
}

export interface ShrugRepEvent {
  /** Peak shoulder elevation (normalized units) this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface ShrugFrameMetrics {
  /** Raw shoulder elevation delta (this frame). */
  shrugDelta: number;
  /** EMA-smoothed shoulder elevation delta. */
  smoothedShrugDelta: number;
  repState: ShrugRepState;
  torsoSwing: boolean;
}

export interface ShrugEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: ShrugRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ShrugFrameMetrics) => void;
}
