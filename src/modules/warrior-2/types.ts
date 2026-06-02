import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Side-on baseline locked at calibration confirm. */
export interface WarriorTwoBaseline {
  /** Which side faces the camera (the visible-chain side). */
  side: 'left' | 'right';
  /** Which leg is the FRONT leg (auto-detected at calibration as the leg with
   *  the larger knee flex). The opposite leg is the back leg. */
  frontLeg: 'left' | 'right';
  /** Shoulder Y at calibration — used to detect "user stood fully back up". */
  shoulderY: number;
  /** Hip mid Y at calibration. */
  hipMidY: number;
  /** Body height (ankle Y minus shoulder Y) — distance reference for side-on pose. */
  bodyHeight: number;
  /** Initial front-knee flex at calibration (sanity reference). */
  initialFrontKneeFlexDeg: number;
  /** Initial trunk lean at calibration (sanity reference). */
  initialTrunkLeanDeg: number;
}

export interface WarriorTwoFrameMetrics {
  /** EMA-smoothed front-knee flex (0 = straight, ~90 = thighs parallel). */
  frontKneeFlexDeg: number;
  /** EMA-smoothed back-knee flex (target ~0). */
  backKneeFlexDeg: number;
  /** EMA-smoothed trunk lean from vertical (0 = upright, positive = forward). */
  trunkLeanDeg: number;
  /** Shoulder rise vs baseline. */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface WarriorTwoEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: WarriorTwoFrameMetrics) => void;
}
