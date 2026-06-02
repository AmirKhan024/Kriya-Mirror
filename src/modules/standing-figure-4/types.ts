import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface Figure4Baseline {
  /** Reference CoM proxy at the START of the HOLD (first ~30 frames post-cal). */
  comX: number;
  comY: number;
  /** Shoulder width at calibration (used to normalize sway → distance-independent). */
  shoulderWidth: number;
  /** Which leg is CROSSED over the standing knee (auto-detected). The OPPOSITE
   *  leg is the standing/weight-bearing leg. */
  liftedSide: 'left' | 'right';
  /** Standing-side ankle Y at calibration (used to detect foot-dropped). */
  standingAnkleY: number;
  /** Crossed-side ankle Y at calibration (initial elevation reference). */
  liftedAnkleY: number;
  /** Standing-side knee X at calibration — the reference for the foot-on-leg
   *  check (crossed ankle X should stay near this X). */
  standingKneeX: number;
  /** Shoulder Y at calibration — used to detect "user stood up". */
  shoulderY: number;
}

export interface Figure4FrameMetrics {
  /** Smoothed CoM-proxy sway angle in degrees. */
  swayAngleDeg: number;
  swayDisplacement: number;
  /** Live hip drop on the crossed side (in normalized y-units). */
  hipDropAmount: number;
  /** Horizontal distance between crossed ankle X and standing knee X
   *  (in normalized x-units). Above the threshold = foot drifted off the knee. */
  footOffLegDistance: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface Figure4EngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: Figure4FrameMetrics) => void;
}
