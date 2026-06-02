import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Side-on baseline locked at calibration confirm for Boat Pose (the seated V). */
export interface BoatPoseBaseline {
  /** Torso length (shoulder-mid → hip-mid distance) — distance scale. */
  torsoLen: number;
  /** Initial torso angle from horizontal at cal (sanity reference). */
  initialTorsoAngleDeg: number;
  /** Initial leg angle from horizontal at cal (sanity reference). */
  initialLegAngleDeg: number;
}

export interface BoatPoseFrameMetrics {
  /** EMA-smoothed torso angle from horizontal (chest lifted / leaning back). */
  torsoAngleDeg: number;
  /** EMA-smoothed leg angle from horizontal (legs lifted into the V). */
  legAngleDeg: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface BoatPoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: BoatPoseFrameMetrics) => void;
}
