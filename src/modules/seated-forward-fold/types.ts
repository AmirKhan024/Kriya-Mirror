import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/**
 * Seated Forward Fold (Paschimottanasana) baseline.
 *
 * Calibration happens IN the folded pose (long-sitting, legs extended on the
 * floor, torso folded forward over them), like cobra / standing-forward-fold.
 * The runtime hold metric is the torso fold angle — a pure geometric ANGLE that
 * needs no distance normalization. The only place distance matters is the
 * calibration gate, which uses the leg span |hipX − ankleX|.
 */
export interface SeatedForwardFoldBaseline {
  /** Which side faces the camera (better-visibility side at calibration). */
  side: 'left' | 'right';
  /** Shoulder Y at calibration. Reference only. */
  shoulderY: number;
  /** Hip Y at calibration. Reference only. */
  hipY: number;
  /** |shoulderX − ankleX| at calibration — horizontal body span (distance proxy). */
  bodyLengthX: number;
}

export interface SeatedForwardFoldFrameMetrics {
  /** Smoothed torso fold angle from vertical (0 = sitting tall, 90 = folded over the legs). */
  foldAngleDeg: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface SeatedForwardFoldEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SeatedForwardFoldFrameMetrics) => void;
}
