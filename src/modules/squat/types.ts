import type { WarningType } from '@/store/workout';

export type RepState = 'STANDING' | 'DESCENDING' | 'AT_BOTTOM' | 'ASCENDING';

export type CalibrationState = 'waiting' | 'good' | 'confirmed' | 'timeout';

export interface CalibrationBaseline {
  shoulderMid: { x: number; y: number };
  hipMid: { x: number; y: number };
  hipWidth: number;
  shoulderWidth: number;
  torsoHeight: number;
  ankleY: number;
  feetWidth: number;
  feetVsShoulderRatio: number;
  leftKneeX: number;
  rightKneeX: number;
}

/** Calibration gate-failure hint. Identifies WHICH gate to coach the user on
 *  first (highest priority blocker). Used by the play page to render the
 *  prominent top banner + voice prompt during calibration. */
export type MostBlockingGate =
  | 'no-body'           // fullBodyVisible failed
  | 'too-far'           // distanceOk failed, body span too small
  | 'too-close'         // distanceOk failed, body span too large
  | 'feet-narrow'       // feetWide failed (squat) / not-horizontal (plank)
  | 'arms-not-overhead' // armsOverhead failed (squat) / no-forearm (plank)
  | null;

export interface CalibrationUpdate {
  state: CalibrationState;
  progressMs: number;
  checks: {
    fullBodyVisible: boolean;
    feetWide: boolean;
    armsOverhead: boolean;
    distanceOk: boolean;
  };
  /** Live hint when distanceOk is false. 'too-close' | 'too-far' | null */
  distanceHint: 'too-close' | 'too-far' | null;
  /** Single most-actionable failing gate (priority: body > distance > feet > arms).
   *  Null when calibration has passed or no landmarks visible. Drives the
   *  prominent top banner + voice coaching during calibration.
   *  OPTIONAL — only squat populates this so far; plank will adopt next round. */
  mostBlockingGate?: MostBlockingGate;
  /** Ms since the user stopped moving (in-frame but static).
   *  > 0 means "user appears idle" — play page can prompt "Please move into position".
   *  OPTIONAL — only squat populates this so far. */
  idleHintMs?: number;
  baseline?: CalibrationBaseline;
}

export interface RepCompleteEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface FrameMetrics {
  kneeFlexionDeg: number;
  smoothedFlexionDeg: number;
  repState: RepState;
  trunkLeanDeg: number;
  heelLifted: boolean;
  kneesValgus: boolean;
  feetTooNarrow: boolean;
  notFacing: boolean;
  tooFar: boolean;
  tooClose: boolean;
}

export interface SquatEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: RepCompleteEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: FrameMetrics) => void;
}
