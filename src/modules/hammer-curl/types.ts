import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type HammerCurlRepState = 'EXTENDED' | 'CURLING' | 'AT_TOP' | 'LOWERING';

/** Extends squat's calibration baseline with hammer-curl-specific arm anchors. */
export interface HammerCurlBaseline extends CalibrationBaseline {
  /** Baseline elbow X for each arm — used for elbow-drift detection. */
  leftElbowX: number;
  rightElbowX: number;
  /** Baseline shoulder X midpoint — used for torso-swing detection. */
  shoulderMidX: number;
}

export interface HammerCurlRepEvent {
  /** Average peak elbow flex (degrees) across both arms this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface HammerCurlFrameMetrics {
  /** Raw average elbow flex (this frame). */
  elbowFlexionDeg: number;
  /** EMA-smoothed average elbow flex. */
  smoothedFlexionDeg: number;
  repState: HammerCurlRepState;
  /** Live left + right elbow flex (for asymmetry readout). */
  leftElbowDeg: number;
  rightElbowDeg: number;
  torsoSwing: boolean;
  elbowDrift: boolean;
}

export interface HammerCurlEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: HammerCurlRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: HammerCurlFrameMetrics) => void;
}
