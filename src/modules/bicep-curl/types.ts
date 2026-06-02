import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type BicepCurlRepState = 'EXTENDED' | 'CURLING' | 'AT_TOP' | 'LOWERING';

/** Re-export squat's calibration baseline — bicep curl captures the same
 *  fundamental fields (shoulder/hip positions, widths, knee positions) plus
 *  arm-specific anchors stored separately. */
export interface BicepCurlBaseline extends CalibrationBaseline {
  /** Baseline elbow X for each arm (used for elbow-drift detection — elbows
   *  should stay pinned near these X values during the rep). */
  leftElbowX: number;
  rightElbowX: number;
  /** Baseline shoulder X midpoint (used for torso-swing detection). */
  shoulderMidX: number;
}

export interface BicepCurlRepEvent {
  /** Average peak elbow flex (degrees) across both arms this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface BicepCurlFrameMetrics {
  /** Raw average elbow flex (this frame). */
  elbowFlexionDeg: number;
  /** EMA-smoothed average elbow flex. */
  smoothedFlexionDeg: number;
  repState: BicepCurlRepState;
  /** Live left + right elbow flex (for the asymmetry HUD readout). */
  leftElbowDeg: number;
  rightElbowDeg: number;
  torsoSwing: boolean;
  elbowDrift: boolean;
}

export interface BicepCurlEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: BicepCurlRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: BicepCurlFrameMetrics) => void;
}
