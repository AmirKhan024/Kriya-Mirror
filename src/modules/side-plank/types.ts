import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Baseline locked at calibration confirm for Side Plank (chest-facing). */
export interface SidePlankBaseline {
  /** Shoulder-mid Y in the held side plank — used to detect "user sat/stood up". */
  shoulderY: number;
  /** Hip-mid Y at calibration — the reference the hip should stay near (sag/pike). */
  hipY: number;
  /** Ankle-mid Y at calibration. */
  ankleY: number;
  /** Body length (shoulder-mid → ankle-mid X distance) — distance scale. */
  bodyLength: number;
  /** Initial spine deviation at cal (sanity reference). */
  initialSpineDeg: number;
}

export interface SidePlankFrameMetrics {
  /** Smoothed hip sag amount (positive only). */
  hipSagAmount: number;
  /** Smoothed hip pike amount (positive only). */
  hipPikeAmount: number;
  /** Smoothed spine deviation in degrees. */
  spineDeviationDeg: number;
  /** Shoulder rise vs baseline. */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface SidePlankEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SidePlankFrameMetrics) => void;
}
