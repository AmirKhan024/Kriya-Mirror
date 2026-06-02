import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

/** Front-on baseline locked at calibration confirm. */
export interface GoddessPoseBaseline {
  /** Shoulder mid Y at calibration — used to detect "user stood fully back up". */
  shoulderY: number;
  /** Shoulder width at calibration — distance normalizer for all X/Y deltas.
   *  Already passed the calibration Fix-X floor (>= 0.08). At runtime,
   *  guard divisions with Math.max(shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME). */
  shoulderWidth: number;
  /** Body height (ankle Y minus shoulder Y) — secondary distance reference. */
  bodyHeight: number;
  /** Initial ankle X separation — used to detect stance drift. */
  ankleXDist: number;
  /** Initial mean knee flex at calibration (sanity reference). */
  initialAvgKneeFlexDeg: number;
  /** Initial elbow Y offset relative to shoulder Y (cactus posture reference).
   *  Stored as (elbowY − shoulderY) — negative means elbow above shoulder in
   *  MediaPipe coords (Y grows downward). At goddess cal, elbow should sit
   *  roughly at shoulder Y, so this is near 0. */
  initialElbowYRelShoulder: number;
}

export interface GoddessPoseFrameMetrics {
  /** EMA-smoothed mean knee flex (average of L + R). */
  avgKneeFlexDeg: number;
  /** EMA-smoothed ratio of knee X separation to ankle X separation.
   *  1.0 = knees aligned over ankles; < 0.75 = caving inward (valgus). */
  kneeAnkleRatio: number;
  /** EMA-smoothed elbow drop — how far either elbow has fallen below the
   *  baseline elbow line, in shoulder-width units. 0 = at cactus height,
   *  positive = dropped. */
  elbowDrop: number;
  /** EMA-smoothed trunk lean from vertical (0 = upright, positive = forward). */
  trunkLeanDeg: number;
  /** Shoulder rise vs baseline (positive when user stood up). */
  shoulderRise: number;
  /** EMA-smoothed form score 0–100. */
  formScore: number;
  /** True only on the frame the hold terminates. */
  isHoldBroken: boolean;
}

export interface GoddessPoseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: {
    secondsElapsed: number;
    mqs: number;
    longestUnfrozenSec?: number;
    warning?: WarningType;
  }) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: GoddessPoseFrameMetrics) => void;
}
