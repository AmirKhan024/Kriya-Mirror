import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 2-state machine: CLOSED (rest position) ↔ OPEN (arms overhead + feet apart).
 *  Each full cycle (CLOSED → OPEN → CLOSED) counts as one rep. */
export type JumpingJacksRepState = 'CLOSED' | 'OPEN';

/** Calibration baseline. Extends the squat-shaped fields so the play page
 *  can render the shared overlay; adds `shoulderMidX` (torso-swing reference)
 *  and `shoulderMidY` (arm-openness reference). */
export interface JumpingJacksBaseline extends CalibrationBaseline {
  shoulderMidX: number;
  shoulderMidY: number;
}

export interface JumpingJacksRepEvent {
  /** Peak composite openness this rep, as a percent of shoulder width. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface JumpingJacksFrameMetrics {
  /** Per-frame arm openness — wrists' height above shoulders, as % of shoulder width. */
  armOpennessPct: number;
  /** Per-frame leg openness — feet separation, as % of shoulder width. */
  legOpennessPct: number;
  /** Average of arm + leg openness; drives the state machine. */
  compositeOpennessPct: number;
  /** EMA-smoothed composite. */
  smoothedCompositePct: number;
  /** Per-side arm openness (live HUD + symmetry check). */
  leftArmOpennessPct: number;
  rightArmOpennessPct: number;
  /** Per-side ankle X distance from body center, as % of shoulder width. */
  leftAnkleOffsetPct: number;
  rightAnkleOffsetPct: number;
  repState: JumpingJacksRepState;
  torsoSwing: boolean;
}

export interface JumpingJacksEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: JumpingJacksRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: JumpingJacksFrameMetrics) => void;
}
