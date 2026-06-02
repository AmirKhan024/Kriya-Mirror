/**
 * Shared engine interface. Every exercise's engine implements this so the play
 * page can dispatch generically (by `exercise.engineModule`).
 *
 * Two flavours of completion event:
 *   - rep-based engines fire `onRepComplete` (Squat, Push-Up, Lunge, Glute Bridge)
 *   - hold-based engines fire `onHoldTick` per second + `onHoldBroken` on collapse (Plank, Tree Pose)
 *
 * All engines share calibration, posture warnings, and per-frame metrics.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import type { CalibrationUpdate } from '@/modules/squat/types';

export interface RepEvent {
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
}

export interface HoldTickEvent {
  /** Seconds elapsed since calibration confirmed (i.e. since hold began) */
  secondsElapsed: number;
  /** Form score sample for this tick (0–100) */
  mqs: number;
  /** Optional warning that fired during this tick */
  warning?: WarningType;
}

export interface ExerciseEngineCallbacks {
  onCalibrationUpdate?: (update: CalibrationUpdate) => void;
  onRepComplete?: (rep: RepEvent) => void;
  onHoldTick?: (tick: HoldTickEvent) => void;
  onHoldBroken?: () => void;
  onPostureWarning?: (warning: WarningType) => void;
  onFrame?: (metrics: { smoothedFlexionDeg?: number; [k: string]: unknown }) => void;
}

export interface ExerciseEngine {
  /** Feed one pose frame. Engine routes internally (calibration → tracking). */
  update(landmarks: PoseLandmarks | null, now: number): void;
  /** Force-complete (e.g. user quit). */
  finish(): void;
  /** Reset for the next set (rep-based only; hold-based engines may no-op). */
  resetForNextSet(): void;
}
