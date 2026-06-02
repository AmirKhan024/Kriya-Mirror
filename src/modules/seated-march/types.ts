import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 3-state machine — BOTH_DOWN (rest), LEFT_UP, RIGHT_UP (alternating active
 *  states). Reps are counted on EXIT from any UP state (transition to the other
 *  UP state, or back to BOTH_DOWN). Mirrors High Knees. */
export type SeatedMarchRepState = 'BOTH_DOWN' | 'LEFT_UP' | 'RIGHT_UP';

/** Calibration baseline — squat-shaped fields plus per-side knee Y references
 *  (reps are alternating-unilateral) and the shoulder midpoint X for
 *  torso-swing tracking. */
export interface SeatedMarchBaseline extends CalibrationBaseline {
  baselineLeftKneeY: number;
  baselineRightKneeY: number;
  shoulderMidX: number;
}

export interface SeatedMarchRepEvent {
  /** Peak knee lift this rep, as % of shoulder width. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  /** Which side this rep was — 'left' = left knee lifted, 'right' = right knee. */
  side: 'left' | 'right';
  warnings: WarningType[];
}

export interface SeatedMarchFrameMetrics {
  leftKneeLiftPct: number;
  rightKneeLiftPct: number;
  smoothedLeftLift: number;
  smoothedRightLift: number;
  repState: SeatedMarchRepState;
  torsoSwing: boolean;
}

export interface SeatedMarchEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: SeatedMarchRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SeatedMarchFrameMetrics) => void;
}
