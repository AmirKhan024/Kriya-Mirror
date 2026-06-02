import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/**
 * Cobra Pose (Bhujangasana) baseline.
 *
 * Calibration happens IN the pose (prone, chest lifted), like plank / chair-pose.
 * The runtime hold metric is the torso elevation angle — a pure geometric ANGLE
 * that needs no distance normalization (the Fix X collapse mode cannot occur).
 * The only place distance matters is the calibration gate, which uses the
 * horizontal body span |shoulderX − ankleX|.
 */
export interface CobraPoseBaseline {
  /** Which side faces the camera (better-visibility side at calibration). */
  side: 'left' | 'right';
  /** Shoulder Y at calibration (chest lifted). Reference only. */
  shoulderY: number;
  /** Hip Y at calibration (on the floor). Reference only. */
  hipY: number;
  /** |shoulderX − ankleX| at calibration — horizontal body span (distance proxy). */
  bodyLengthX: number;
}

export interface CobraPoseFrameMetrics {
  /** Smoothed torso elevation angle (~0 = lying flat, higher = chest lifted). */
  elevationDeg: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface CobraPoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: CobraPoseFrameMetrics) => void;
}
