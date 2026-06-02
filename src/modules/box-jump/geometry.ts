/**
 * Box-jump geometry helpers — side camera.
 *
 * Re-exports landmark constants and visibility from squat/geometry.
 * Re-exports kneeFlexionDeg (used for landing absorption detection).
 * Adds hip Y velocity and displacement helpers for the explosive jump detection.
 */

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  kneeFlexionDeg,
} from '@/modules/squat/geometry';

/**
 * Hip vertical velocity in normalised frame units per second.
 * Positive = moving down (Y increases in MediaPipe screen coords).
 * Negative = moving up (jumping).
 */
export function hipYVelocity(currentHipY: number, prevHipY: number, dtSeconds: number): number {
  if (dtSeconds <= 0) return 0;
  return (currentHipY - prevHipY) / dtSeconds;
}

/**
 * Hip displacement from calibration baseline.
 * Positive = hip has dropped below baseline (loading squat).
 * Negative = hip has risen above baseline (airborne / on top of box).
 */
export function hipYDisplacementFromBaseline(currentHipY: number, baselineHipY: number): number {
  return currentHipY - baselineHipY;
}
