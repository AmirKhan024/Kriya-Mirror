import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Front-on baseline locked at calibration confirm. */
export interface TrianglePoseBaseline {
  /** Which arm is raised toward the sky. Auto-detected at calibration as
   *  the wrist with the smaller Y value (higher in the frame). The opposite
   *  arm is the bottom arm reaching toward the front foot. */
  topArm: 'left' | 'right';
  /** Which leg is the FRONT leg (the leg over which the trunk hinges). The
   *  bottom arm reaches toward this leg's ankle. Convention: opposite of
   *  topArm (classical triangle pose). */
  frontLeg: 'left' | 'right';
  /** Shoulder mid Y at calibration — terminal hold-broken reference. */
  shoulderY: number;
  /** Shoulder width at calibration — distance normalizer for all X/Y deltas.
   *  Already passed the calibration Fix-X floor (>= 0.08). At runtime,
   *  guard divisions with Math.max(shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME). */
  shoulderWidth: number;
  /** Body height (ankle Y minus shoulder Y) — secondary distance reference,
   *  also used as the normalizer for the bottom-arm-to-ankle measurement. */
  bodyHeight: number;
  /** Initial mean knee flex at calibration (sanity reference). */
  initialAvgKneeFlexDeg: number;
  /** Initial top-arm deviation from vertical at calibration (sanity). */
  initialTopArmDeviationDeg: number;
  /** Initial bottom-arm vertical distance from the front ankle (sanity). */
  initialBottomArmFromAnkleY: number;
}

export interface TrianglePoseFrameMetrics {
  /** EMA-smoothed front-leg knee flex. */
  frontKneeFlexDeg: number;
  /** EMA-smoothed back-leg knee flex. */
  backKneeFlexDeg: number;
  /** EMA-smoothed deviation of the top-arm vector from vertical
   *  (0 = perfectly straight up). */
  topArmDeviationDeg: number;
  /** EMA-smoothed (bottomWrist.y − frontAnkle.y) / bodyHeight.
   *  ≤ 0 = wrist below the ankle (ideal). Positive = wrist lifted above
   *  the ankle. > 0.15 fires `bottom-arm-not-down`. */
  bottomArmFromAnkleY: number;
  /** Shoulder rise vs baseline (positive when user stood up). */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface TrianglePoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: TrianglePoseFrameMetrics) => void;
}
