import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 2026-05-28 round 21: Arm Circles re-architected to FRONT-camera + 4-state
 *  bilateral-abduction machine (mirror lateral-raise). Each rep = one full
 *  sweep DOWN → UP (overhead) → DOWN. The circular motion the user does
 *  (forward/backward circles) is instructional only — engine counts the
 *  vertical oscillation amplitude. */
export type ArmCirclesRepState = 'DOWN' | 'RISING' | 'AT_TOP' | 'LOWERING';

export interface ArmCirclesBaseline extends CalibrationBaseline {
  shoulderMidX: number;
}

export interface ArmCirclesRepEvent {
  /** Peak shoulder-abduction angle (degrees) averaged across both arms. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface ArmCirclesFrameMetrics {
  /** Raw per-frame average shoulder-abduction angle. */
  abductionDeg: number;
  /** EMA-smoothed average shoulder-abduction angle. */
  smoothedAbductionDeg: number;
  repState: ArmCirclesRepState;
  /** Per-arm shoulder abduction (for asymmetry HUD readout). */
  leftAbductionDeg: number;
  rightAbductionDeg: number;
  torsoSwing: boolean;
}

export interface ArmCirclesEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: ArmCirclesRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ArmCirclesFrameMetrics) => void;
}
