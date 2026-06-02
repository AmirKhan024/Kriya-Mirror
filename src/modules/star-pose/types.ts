import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface StarPoseBaseline {
  /** Reference CoM proxy at the START of the HOLD (first ~30 frames post-cal). */
  comX: number;
  comY: number;
  /** Shoulder width at calibration (normalizes sway → distance-independent). */
  shoulderWidth: number;
  /** Which leg is EXTENDED laterally (auto-detected at calibration). The
   *  OPPOSITE leg is the standing/weight-bearing leg. */
  liftedSide: 'left' | 'right';
  /** Standing-side ankle Y at calibration. */
  standingAnkleY: number;
  /** Extended-side ankle Y at calibration (initial elevation reference). */
  liftedAnkleY: number;
  /** |leftAnkle.x - rightAnkle.x| at calibration — reference for how wide the
   *  star stance is, used to detect the leg retracting back in. */
  ankleXSep: number;
  /** Shoulder Y at calibration — used to detect "user stood up" (hold broken). */
  shoulderY: number;
}

export interface StarPoseFrameMetrics {
  /** Smoothed CoM-proxy sway angle in degrees. */
  swayAngleDeg: number;
  swayDisplacement: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface StarPoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: StarPoseFrameMetrics) => void;
}
