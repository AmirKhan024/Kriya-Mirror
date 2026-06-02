import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface TandemStandBaseline {
  /** CoM (center-of-mass) proxy at the START of the HOLD (not calibration —
   *  captured from the first ~10 valid frames of the hold per BB5 spec). */
  comX: number;
  comY: number;
  /** Shoulder width at calibration (used to normalize sway → distance-independent). */
  shoulderWidth: number;
  /** Trunk length (shoulder→hip distance), used for hands-on-hips check. */
  trunkLength: number;
  /** Baseline ankle x-distance at calibration. Used to detect feet drifting apart. */
  ankleXDistance: number;
  /** Shoulder y at calibration — used to detect "user stood up out of stance". */
  shoulderY: number;
}

export interface TandemStandFrameMetrics {
  /** Smoothed CoM-proxy sway angle in degrees (per BB5 §1). */
  swayAngleDeg: number;
  /** Smoothed sway displacement (normalized distance). */
  swayDisplacement: number;
  /** Current trunk lean from vertical in degrees. */
  trunkLeanDeg: number;
  /** Live ankle X distance (tandem-drift indicator). */
  ankleXDistance: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  /** Did the hold break this frame (feet out of stance OR user stood)? */
  isHoldBroken: boolean;
}

export interface TandemStandEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: TandemStandFrameMetrics) => void;
}
