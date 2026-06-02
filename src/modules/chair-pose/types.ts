import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Side-on baseline locked at calibration confirm. */
export interface ChairPoseBaseline {
  /** Which side faces the camera. */
  side: 'left' | 'right';
  /** Shoulder Y at calibration — used to detect "user stood fully back up" (hold-broken). */
  shoulderY: number;
  /** Hip Y at calibration. */
  hipY: number;
  /** Knee Y at calibration. */
  kneeY: number;
  /** Ankle Y at calibration — used to detect heel-lift. */
  ankleY: number;
  /** Body height: |ankle.y − shoulder.y|. Primary distance reference for side-on pose. */
  bodyHeight: number;
  /** Knee flexion at calibration (squat geometry: 0 = straight, ~90 = thighs parallel). */
  initialKneeFlexionDeg: number;
  /** Trunk lean at calibration in degrees from vertical (0 = upright). */
  initialTrunkLeanDeg: number;
}

export interface ChairPoseFrameMetrics {
  /** Current EMA-smoothed knee flexion (0 = standing, 90 = parallel, 150 = deep squat). */
  kneeFlexionDeg: number;
  /** Current EMA-smoothed trunk lean from vertical (0 = upright, positive = forward). */
  trunkLeanDeg: number;
  /** Heel lift amount: max(0, baseline.ankleY − currentAnkleY) in normalized coords. */
  heelLiftAmount: number;
  /** Shoulder rise vs baseline: positive value means user is standing back up. */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface ChairPoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  /** Tick payload mirrors tandem-stand: `longestUnfrozenSec` carries the
   *  longest continuous valid streak (Fix U) for the report. */
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: ChairPoseFrameMetrics) => void;
}
