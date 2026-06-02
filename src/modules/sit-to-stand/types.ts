import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Inverted-squat state machine. Rest is SEATED (knees flexed ~90°); a rep is
 *  the stand-up. SEATED → RISING (knees extending) → STANDING (counted) →
 *  SEATED (sat back down, re-armed). */
export type SitToStandRepState = 'SEATED' | 'RISING' | 'STANDING';

export interface SitToStandBaseline {
  /** Which side faces the camera (better-visibility side). */
  side: 'left' | 'right';
  /** Knee flexion captured while seated at calibration (degrees). */
  seatedKneeFlexDeg: number;
  /** Shoulder Y at calibration. */
  shoulderY: number;
  /** Hip Y at calibration. */
  hipY: number;
  /** Ankle Y at calibration (floor reference). */
  ankleY: number;
  /** |ankle.y − shoulder.y| at calibration — distance reference for side-on pose. */
  bodyHeight: number;
}

export interface SitToStandRepEvent {
  /** Knee-extension range this rep (seated flex − standing flex), in degrees. */
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface SitToStandFrameMetrics {
  kneeFlexionDeg: number;
  smoothedFlexionDeg: number;
  repState: SitToStandRepState;
}

export interface SitToStandEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: SitToStandRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: SitToStandFrameMetrics) => void;
}
