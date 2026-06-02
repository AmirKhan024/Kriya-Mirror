import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type FrontRaiseRepState = 'DOWN' | 'RISING' | 'AT_TOP' | 'LOWERING';

/** 2026-05-28 round 21: front raise re-architected to FRONT-camera (mirror
 *  lateral-raise). `shoulderMidX` is the torso-swing reference. Side-view
 *  fields (`side`, `bodyHeight`) dropped — front view uses shoulderWidth from
 *  the base baseline as its distance reference. */
export interface FrontRaiseBaseline extends CalibrationBaseline {
  shoulderMidX: number;
}

export interface FrontRaiseRepEvent {
  /** Average peak shoulder-flexion angle (degrees) across both arms this rep. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface FrontRaiseFrameMetrics {
  /** Raw average shoulder-flexion angle (this frame). */
  flexionDeg: number;
  /** EMA-smoothed average shoulder-flexion angle. */
  smoothedFlexionDeg: number;
  repState: FrontRaiseRepState;
  /** Live per-arm shoulder-flexion (for the asymmetry HUD readout). */
  leftFlexionDeg: number;
  rightFlexionDeg: number;
  torsoSwing: boolean;
}

export interface FrontRaiseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: FrontRaiseRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: FrontRaiseFrameMetrics) => void;
}
