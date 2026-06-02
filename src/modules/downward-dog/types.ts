import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/**
 * Downward Dog (Adho Mukha Svanasana) baseline.
 *
 * Calibration happens IN the pose (inverted V), like plank / chair-pose. The
 * runtime hold metric is the hip apex angle — a pure geometric ANGLE that needs
 * no distance normalization (the Fix X collapse mode cannot occur). The only
 * place distance matters is the calibration gate, which uses the vertical leg
 * drop |ankleY − hipY|.
 */
export interface DownwardDogBaseline {
  /** Which side faces the camera (better-visibility side at calibration). */
  side: 'left' | 'right';
  /** Hip Y at calibration (the apex). Reference only. */
  hipY: number;
  /** Ankle Y at calibration. Reference only. */
  ankleY: number;
  /** |ankleY − hipY| at calibration — vertical leg drop (distance proxy). */
  legDropY: number;
}

export interface DownwardDogFrameMetrics {
  /** Smoothed hip apex interior angle (~90 = sharp inverted V, →180 = flat). */
  apexAngleDeg: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface DownwardDogEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: DownwardDogFrameMetrics) => void;
}
