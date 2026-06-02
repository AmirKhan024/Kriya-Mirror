import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type LateralRaiseRepState = 'DOWN' | 'RISING' | 'AT_TOP' | 'LOWERING';

/** Re-export squat's calibration baseline shape (shared with the play page)
 *  plus lateral-raise-specific anchors for torso-swing detection. */
export interface LateralRaiseBaseline extends CalibrationBaseline {
  /** Baseline shoulder X midpoint — torso-swing detection compares against this. */
  shoulderMidX: number;
}

export interface LateralRaiseRepEvent {
  /** Average peak shoulder-abduction angle (degrees) across both arms this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface LateralRaiseFrameMetrics {
  /** Raw average shoulder-abduction angle (this frame). */
  abductionDeg: number;
  /** EMA-smoothed average shoulder-abduction angle. */
  smoothedFlexionDeg: number;     // keep name `smoothedFlexionDeg` for HUD compatibility
  repState: LateralRaiseRepState;
  /** Live left + right shoulder abduction (for the asymmetry HUD readout). */
  leftAbductionDeg: number;
  rightAbductionDeg: number;
  torsoSwing: boolean;
}

export interface LateralRaiseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: LateralRaiseRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: LateralRaiseFrameMetrics) => void;
}
