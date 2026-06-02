import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export type BirdDogRepState = 'AT_REST' | 'EXTENDING' | 'AT_EXTENDED' | 'RETURNING';

export interface BirdDogBaseline {
  side: 'left' | 'right';
  /** Horizontal shoulder-to-ankle span (distance gate). */
  bodyLength: number;
  /** Calibrated hip Y — reference for quadruped position. */
  hipY: number;
  /** Calibrated knee Y — confirms quadruped position at calibration. */
  kneeY: number;
  shoulderY: number;
  ankleY: number;
}

export interface BirdDogRepEvent {
  /** Peak extensionDeg for this rep (stored as depthDeg for shared RepEvent shape). */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface BirdDogFrameMetrics {
  /** Raw hip-knee-ankle angle of active leg (degrees). ~90° at rest, ~160°+ at full extension. */
  kneeAngleDeg: number;
  /** EMA-smoothed (kneeAngle - 90), clamped ≥ 0. 0° at rest, 70°+ at full extension. */
  smoothedExtensionDeg: number;
  repState: BirdDogRepState;
  activeLeg: 'left' | 'right' | null;
}

export interface BirdDogEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: BirdDogRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: BirdDogFrameMetrics) => void;
}
