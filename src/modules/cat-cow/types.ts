import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Baseline captured at calibration — side-on, on all fours, spine neutral. */
export interface CatCowBaseline {
  /** Which side faces the camera (higher landmark visibility). */
  side: 'left' | 'right';
  /** Neutral neck pitch (deg) on all fours — lift is measured relative to this,
   *  so the user's natural head angle is calibrated out. */
  neutralPitchDeg: number;
  /** Camera-side hip X at calibration (rocking forward/back drifts this — form). */
  hipX: number;
  /** Side-on body span |shoulderX − kneeX| at calibration. */
  bodyLengthX: number;
}

export interface CatCowRepEvent {
  /** Total spinal range this cycle = peak extension + peak flexion (degrees). */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

/** Oscillation states for one cat↔cow cycle. */
export type CatCowRepState = 'NEUTRAL' | 'IN_CYCLE';

export interface CatCowFrameMetrics {
  /** Raw per-frame neck-pitch lift (deg above the neutral baseline). Positive =
   *  cow/extension, negative = cat/flexion. */
  pitchLiftDeg: number;
  /** EMA-smoothed lift — drives the cycle detection. */
  smoothedLiftDeg: number;
  repState: CatCowRepState;
  /** Whether the cow (extension) extreme has been reached this cycle. */
  cowReached: boolean;
  /** Whether the cat (flexion) extreme has been reached this cycle. */
  catReached: boolean;
}

export interface CatCowEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: CatCowRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: CatCowFrameMetrics) => void;
}
