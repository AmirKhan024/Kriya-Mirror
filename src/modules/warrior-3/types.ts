import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Side-on baseline locked at calibration confirm for Warrior III (airplane T). */
export interface WarriorThreeBaseline {
  /** Which leg is the LIFTED (back) leg — auto-detected as the higher ankle/knee. */
  liftedSide: 'left' | 'right';
  /** Shoulder mid Y at calibration (in the T) — used to detect "user stood fully up". */
  shoulderY: number;
  /** Torso length (shoulder-mid → hip-mid distance) — orientation-independent scale. */
  torsoLen: number;
  /** Initial torso pitch from horizontal at cal (sanity reference). */
  initialTorsoPitchDeg: number;
  /** Initial back-leg angle from horizontal at cal (sanity reference). */
  initialBackLegAngleDeg: number;
}

export interface WarriorThreeFrameMetrics {
  /** EMA-smoothed torso pitch from horizontal (0 = level T, 90 = upright). */
  torsoPitchDeg: number;
  /** EMA-smoothed back-leg angle from horizontal (0 = level, 90 = hanging down). */
  backLegAngleDeg: number;
  /** EMA-smoothed standing-knee flex (0 = straight). */
  standingKneeFlexDeg: number;
  /** Shoulder rise vs baseline. */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface WarriorThreeEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: WarriorThreeFrameMetrics) => void;
}
