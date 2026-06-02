import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** State machine for overhead press:
 *  RACKED → PRESSING → LOCKED_OUT → LOWERING → RACKED (rep complete) */
export type OHPRepState = 'RACKED' | 'PRESSING' | 'LOCKED_OUT' | 'LOWERING';

/** Baseline captured at calibration confirm (bar in front rack position). */
export interface OHPBaseline extends CalibrationBaseline {
  /** Shoulder Y reference (shoulder height in frame). */
  shoulderY: number;
  /** Shoulder midpoint X (bar path horizontal reference). */
  shoulderMidX: number;
  /** Hip Y reference (for back hyperextension check). */
  hipY: number;
  /** Hip midpoint X (for hyperextension check). */
  hipMidX: number;
  /** Wrist Y at racked position (start reference). */
  wristY: number;
  /** Left elbow X at rest (for elbow-cave detection). */
  leftElbowX: number;
  /** Right elbow X at rest (for elbow-cave detection). */
  rightElbowX: number;
}

export interface OHPRepEvent {
  /** Average peak elbow extension (degrees) across both arms this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface OHPFrameMetrics {
  /** Raw average elbow extension (degrees, this frame). */
  elbowExtensionDeg: number;
  /** EMA-smoothed average elbow extension. */
  smoothedExtensionDeg: number;
  repState: OHPRepState;
  leftElbowDeg: number;
  rightElbowDeg: number;
  backArch: boolean;
  barPathDrift: boolean;
}

export interface OHPEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: OHPRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: OHPFrameMetrics) => void;
}
