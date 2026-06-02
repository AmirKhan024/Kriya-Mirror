/**
 * Burpee geometry helpers.
 * Side-camera exercise — re-export from squat/geometry.
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

import type { NormalizedLandmark } from '@/modules/pose/types';

/**
 * Hip deviation from the plank body line.
 * Uses the shoulder-ankle line as the reference (same as pushup engine).
 * Positive = hip sagging below the line (bad).
 * Negative = hip piked above the line (also bad but different issue).
 */
export function hipPlankDeviationFromLine(
  shoulderY: number,
  hipY: number,
  ankleY: number,
): number {
  // Expected hip Y if body were perfectly horizontal (midpoint of shoulder-ankle)
  const expectedHipY = shoulderY + (ankleY - shoulderY) * 0.5;
  return hipY - expectedHipY;
}

/**
 * Hip Y offset from the standing baseline.
 * Positive = hip has dropped (squatting/plank).
 * Negative = hip has risen above baseline (jump).
 */
export function hipYOffset(currentHipY: number, baselineHipY: number): number {
  return currentHipY - baselineHipY;
}

/**
 * Angle at knee in degrees (interior angle — 180° = fully straight).
 * Returns a value in [0, 180] where 0 = fully bent, 180 = fully extended.
 * This is the EXTENSION angle (complement of flexion).
 */
export function kneeExtensionDeg(
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
  ankle: NormalizedLandmark,
): number {
  const ux = hip.x - knee.x;
  const uy = hip.y - knee.y;
  const vx = ankle.x - knee.x;
  const vy = ankle.y - knee.y;
  const dot = ux * vx + uy * vy;
  const cross = Math.abs(ux * vy - uy * vx);
  const angleAtKnee = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.max(0, Math.min(180, angleAtKnee));
}
