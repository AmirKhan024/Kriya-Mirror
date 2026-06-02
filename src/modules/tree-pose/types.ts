import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface TreePoseBaseline {
  /** Reference CoM proxy at the START of the HOLD (first ~30 frames post-cal). */
  comX: number;
  comY: number;
  /** Shoulder width at calibration (used to normalize sway → distance-independent). */
  shoulderWidth: number;
  /** Which leg is lifted (auto-detected at calibration). The OPPOSITE leg
   *  is the standing leg. */
  liftedSide: 'left' | 'right';
  /** Standing-side ankle Y at calibration (used to detect foot-dropped). */
  standingAnkleY: number;
  /** Lifted-side ankle Y at calibration (initial elevation reference). */
  liftedAnkleY: number;
  /** Standing-side knee X at calibration — the reference for the foot-on-leg
   *  check (lifted ankle X should stay near this X). */
  standingKneeX: number;
  /** Shoulder Y at calibration — used to detect "user stood down". */
  shoulderY: number;
}

export interface TreePoseFrameMetrics {
  /** Smoothed CoM-proxy sway angle in degrees. */
  swayAngleDeg: number;
  swayDisplacement: number;
  /** Live hip drop on the lifted side (in normalized y-units). */
  hipDropAmount: number;
  /** Horizontal distance between lifted ankle X and standing knee X
   *  (in normalized x-units). Above the threshold = foot drifted off the leg. */
  footOffLegDistance: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface TreePoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: TreePoseFrameMetrics) => void;
}
