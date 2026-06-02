import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type OTERepState = 'EXTENDED' | 'LOWERING' | 'AT_BOTTOM' | 'PRESSING';

/** Baseline captured at calibration (arms extended overhead). Extends
 *  the shared CalibrationBaseline so the play page can read it uniformly. */
export interface OTEBaseline extends CalibrationBaseline {
  /** Vertical distance (in normalised Y) from shoulder to elbow at calibration.
   *  Used as denominator in tricepExtDeg. shoulder.y > elbow.y so this is > 0. */
  upperArmLen: number;
  /** Elbow X at calibration — elbows should stay above shoulders. */
  leftElbowX: number;
  rightElbowX: number;
  /** Shoulder X positions — reference for elbow-flare and torso-swing checks. */
  leftShoulderX: number;
  rightShoulderX: number;
  shoulderMidX: number;
}

export interface OTERepEvent {
  /** How far the arms were lowered this rep (0–90°).
   *  90° = wrists dropped to elbow level (perfect), 0° = no motion. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface OTEFrameMetrics {
  /** Raw left+right average tricepExtDeg this frame. */
  tricepExtDeg: number;
  /** EMA-smoothed value driving the state machine. */
  smoothedExtDeg: number;
  repState: OTERepState;
  leftExtDeg: number;
  rightExtDeg: number;
  elbowFlare: boolean;
  torsoSwing: boolean;
}

export interface OTEEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: OTERepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: OTEFrameMetrics) => void;
}
