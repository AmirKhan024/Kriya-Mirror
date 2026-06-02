import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';

/** 2026-05-28 round 22: calf raise re-architected from REP-based to HOLD-based.
 *  User rises onto the balls of both feet ONCE and holds. Engine tracks the
 *  cumulative time spent in the "heels up" position; heel drops mid-hold pause
 *  the timer + emit a single `heel-dropped` warning (with cooldown) and do NOT
 *  terminate the hold.
 *
 *  Reference implementation: BB6 heel-rise-hold (kriya-activities/balance_new). */
export type CalfRaiseHoldState = 'SETTLING' | 'HOLDING' | 'DROPPED';

export interface CalfRaiseBaseline extends CalibrationBaseline {
  /** Averaged left + right ankle Y at flat-foot (the elevation zero reference). */
  baselineAnkleY: number;
  /** Per-side baselines — used to compute per-side elevation independently
   *  so MediaPipe L/R asymmetry doesn't bias the bilateral max. */
  baselineLeftAnkleY: number;
  baselineRightAnkleY: number;
  /** Shoulder X midpoint — CoM-sway / torso-stability reference. */
  shoulderMidX: number;
  /** Vertical span shoulder-Y → hip-Y at calibration. Drives the initial
   *  `RISE_THRESHOLD = trunkLength × RISE_THRESHOLD_TRUNK_FRAC` before the
   *  adaptive percentile threshold takes over. */
  trunkLength: number;
}

/** Emitted once per second from the engine. `secondsElapsed` reflects ONLY
 *  time spent in the `HOLDING` state — drops pause this counter. */
export interface CalfRaiseHoldTickEvent {
  secondsElapsed: number;
  mqs: number;
  heelDropCount: number;
}

export interface CalfRaiseFrameMetrics {
  /** Bilateral max heel rise (smoothed, in normalized image units — i.e. the
   *  signed elevation in Y after smoothing). */
  smoothedElevation: number;
  /** Raw per-side elevation (bilateral max picks the larger). */
  leftElevation: number;
  rightElevation: number;
  /** Current adaptive drop threshold (the gate elevation must stay above for
   *  the hold to count). */
  dropThreshold: number;
  holdState: CalfRaiseHoldState;
}

export interface CalfRaiseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onHoldTick?: (tick: CalfRaiseHoldTickEvent) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: CalfRaiseFrameMetrics) => void;
}
