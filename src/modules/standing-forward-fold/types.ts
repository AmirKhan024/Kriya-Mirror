import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/**
 * Standing Forward Fold (Uttanasana) baseline.
 *
 * Calibration happens IN the folded pose (like chair-pose / wall-sit), so the
 * baseline captures the side that faces the camera plus a couple of reference
 * Y values. The runtime hold metrics (fold angle, knee flexion) are pure
 * geometric ANGLES — they need no distance normalization, so there is no
 * shoulder-width term to guard (the Fix X failure mode cannot occur here; the
 * calibration distance gate still rejects degenerate too-far baselines).
 */
export interface ForwardFoldBaseline {
  /** Which side faces the camera (better-visibility side at calibration). */
  side: 'left' | 'right';
  /** Shoulder Y at calibration (folded). Reference only. */
  shoulderY: number;
  /** Hip Y at calibration. Reference only. */
  hipY: number;
  /** |ankleY − shoulderY| at calibration — vertical body span (distance proxy). */
  bodyHeightY: number;
}

export interface ForwardFoldFrameMetrics {
  /** Smoothed torso fold angle from vertical (0 = upright, 90 = horizontal hinge). */
  foldAngleDeg: number;
  /** Smoothed knee flexion (0 = legs straight, higher = knees bending). */
  kneeFlexionDeg: number;
  /** Smoothed form score 0–100. */
  formScore: number;
  isHoldBroken: boolean;
}

export interface ForwardFoldEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number; warning?: WarningType }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ForwardFoldFrameMetrics) => void;
}
