import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type SupermanRepState = 'AT_REST' | 'RISING' | 'AT_TOP' | 'LOWERING';

export interface SupermanBaseline {
  side: 'left' | 'right';
  /** Horizontal shoulder-to-ankle span (distance gate). */
  bodyLength: number;
  /** Calibrated hip Y — floor reference. Hips must stay near this. */
  hipY: number;
  /** Calibrated knee Y — confirms prone position at calibration. */
  kneeY: number;
  shoulderY: number;
  ankleY: number;
  /** Calibrated shoulder mid Y — baseline for shoulder-rise detection. */
  shoulderMidY: number;
}

export interface SupermanFrameMetrics {
  /** EMA-smoothed shoulder Y delta from baseline (chest lift). 0 at rest, 0.06+ at top. */
  shoulderRise: number;
  repState: SupermanRepState;
  /** How far hip has lifted above calibrated floor Y (> 0 = lifting). */
  hipLiftAmount: number;
}

export interface SupermanEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: {
    depthDeg: number;
    smoothness: number;
    form: number;
    mqs: number;
    warnings: WarningType[];
  }) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SupermanFrameMetrics) => void;
}
