import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type DeadBugRepState = 'AT_REST' | 'EXTENDING' | 'AT_EXTENDED' | 'RETURNING';

export interface DeadBugBaseline {
  side: 'left' | 'right';
  /** Horizontal shoulder-to-ankle span (distance gate). */
  bodyLength: number;
  /** Calibrated hip Y — floor reference. Hips must stay near this. */
  hipY: number;
  /** Calibrated knee Y — confirms tabletop position at calibration. */
  kneeY: number;
  shoulderY: number;
  ankleY: number;
}

export interface DeadBugFrameMetrics {
  /** Raw hip-knee-ankle angle of active leg (degrees). ~90° at rest, ~150°+ extended. */
  kneeAngleDeg: number;
  /** EMA-smoothed (kneeAngle - 90), clamped ≥ 0. 0° at rest, 60°+ at full extension. */
  smoothedExtensionDeg: number;
  repState: DeadBugRepState;
  /** How far hip has lifted above calibrated floor Y (> 0 = lifting). */
  hipLiftAmount: number;
}

export interface DeadBugEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: {
    depthDeg: number;
    smoothness: number;
    form: number;
    mqs: number;
    warnings: WarningType[];
  }) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: DeadBugFrameMetrics) => void;
}
