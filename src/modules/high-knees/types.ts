import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 3-state machine — BOTH_DOWN (rest), LEFT_UP, RIGHT_UP (alternating active states).
 *  Reps are counted on EXIT from any UP state (transition to the other UP state,
 *  or back to BOTH_DOWN). */
export type HighKneesRepState = 'BOTH_DOWN' | 'LEFT_UP' | 'RIGHT_UP';

/** Calibration baseline. Extends the squat-shaped fields and adds per-side
 *  knee Y references (needed since reps are alternating-unilateral) and the
 *  shoulder midpoint X for torso-swing detection. */
export interface HighKneesBaseline extends CalibrationBaseline {
  baselineLeftKneeY: number;
  baselineRightKneeY: number;
  shoulderMidX: number;
}

export interface HighKneesRepEvent {
  /** Peak knee lift this rep, as % of shoulder width. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  /** Which side this rep was — 'left' = left knee lifted, 'right' = right knee. */
  side: 'left' | 'right';
  warnings: WarningType[];
}

export interface HighKneesFrameMetrics {
  /** Per-side raw knee lift (% of shoulder width, after outlier clamp). */
  leftKneeLiftPct: number;
  rightKneeLiftPct: number;
  /** Per-side EMA-smoothed lift — drives the state machine. */
  smoothedLeftLift: number;
  smoothedRightLift: number;
  repState: HighKneesRepState;
  torsoSwing: boolean;
}

export interface HighKneesEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: HighKneesRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: HighKneesFrameMetrics) => void;
}
