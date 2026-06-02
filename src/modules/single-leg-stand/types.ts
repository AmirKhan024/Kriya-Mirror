import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface SingleLegStandBaseline {
  /** Reference CoM proxy at the START of the HOLD (first ~10 frames post-cal). */
  comX: number;
  comY: number;
  /** Shoulder width at calibration (used to normalize sway → distance-independent). */
  shoulderWidth: number;
  /** Which leg is lifted (auto-detected at calibration). The OPPOSITE leg
   *  is the standing leg. */
  liftedSide: 'left' | 'right';
  /** Standing-side ankle Y at calibration (used to detect hold-broken when
   *  the lifted ankle returns near this Y). */
  standingAnkleY: number;
  /** Lifted-side ankle Y at calibration (initial elevation reference). */
  liftedAnkleY: number;
  /** Shoulder Y at calibration — used to detect "user stood down". */
  shoulderY: number;
}

export interface SingleLegStandFrameMetrics {
  /** Smoothed CoM-proxy sway angle in degrees. */
  swayAngleDeg: number;
  swayDisplacement: number;
  /** Live hip drop on the lifted side (in normalized y-units). */
  hipDropAmount: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface SingleLegStandEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SingleLegStandFrameMetrics) => void;
}
