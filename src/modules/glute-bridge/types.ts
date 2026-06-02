import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type GluteBridgeRepState = 'RESTING' | 'ASCENDING' | 'AT_TOP' | 'DESCENDING';

/**
 * Baseline captured at calibration (user lying on back, knees bent, side-on to camera).
 * kneeAboveHipY is the key normalisation factor: the vertical distance (in normalised
 * frame coords) from the resting hip to the bent knee. This scales proportionally with
 * body size and camera distance, so all thresholds are expressed as fractions of it.
 */
export interface GluteBridgeBaseline {
  shoulderMid: { x: number; y: number };
  hipMid: { x: number; y: number };
  kneeMid: { x: number; y: number };
  ankleMid: { x: number; y: number };
  restingHipY: number;
  /** restingHipY − kneeMid.y — how far the knee is above the hip at rest. */
  kneeAboveHipY: number;
  /** Horizontal distance from shoulder to ankle (body length proxy for distance gate). */
  bodyHorizontalSpan: number;
}

export interface GluteBridgeRepEvent {
  /** Peak hip rise as a fraction of kneeAboveHipY (0–1+). Used as "depthDeg" proxy. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface GluteBridgeFrameMetrics {
  /** Raw hip rise in normalised Y units (positive = hips raised). */
  hipRiseY: number;
  /** Smoothed hip rise. */
  smoothedRiseY: number;
  /** hipRiseY / kneeAboveHipY. */
  hipRiseFraction: number;
  repState: GluteBridgeRepState;
  backArchBad: boolean;
}

export interface GluteBridgeEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: GluteBridgeRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: GluteBridgeFrameMetrics) => void;
}
