import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Front-on baseline locked at calibration confirm. */
export interface GatePoseBaseline {
  /** Which way the torso bends (sign of shoulderMid.x − hipMid.x). The extended
   *  leg is on this side; the top arm is the OPPOSITE side. */
  bendSide: 'left' | 'right';
  /** Which arm arcs up and over (the raised wrist). Opposite of bendSide. */
  topArm: 'left' | 'right';
  /** Shoulder mid Y at calibration — terminal hold-broken reference. */
  shoulderY: number;
  /** Shoulder width at calibration — distance normalizer (Fix X floored ≥ 0.08). */
  shoulderWidth: number;
  /** Body height (ankle Y − shoulder Y) — normalizer for the top-arm height. */
  bodyHeight: number;
  /** Lateral lean magnitude (deg) at calibration. */
  initialLeanDeg: number;
}

export interface GatePoseFrameMetrics {
  /** EMA-smoothed lateral lean magnitude (deg). */
  lateralLeanDeg: number;
  /** EMA-smoothed top-arm height above the shoulder, normalized by bodyHeight
   *  (positive = wrist above shoulder). */
  topArmAbove: number;
  /** Shoulder rise vs baseline (positive when user stood up). */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface GatePoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: GatePoseFrameMetrics) => void;
}
