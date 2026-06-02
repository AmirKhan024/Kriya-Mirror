import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

export type ChairDipRepState = 'EXTENDED' | 'DIPPING' | 'AT_BOTTOM' | 'PRESSING';

/** Extends squat's CalibrationBaseline with arm-specific anchors. */
export interface ChairDipBaseline extends CalibrationBaseline {
  leftElbowX: number;
  rightElbowX: number;
  shoulderMidX: number;
  shoulderMidY: number;
}

export interface ChairDipRepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface ChairDipFrameMetrics {
  elbowFlexionDeg: number;
  smoothedFlexionDeg: number;
  repState: ChairDipRepState;
  leftElbowDeg: number;
  rightElbowDeg: number;
  elbowFlare: boolean;
  torsoSwing: boolean;
}

export interface ChairDipEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (event: ChairDipRepEvent) => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ChairDipFrameMetrics) => void;
}
