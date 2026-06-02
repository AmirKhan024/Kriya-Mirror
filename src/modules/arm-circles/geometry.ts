// Arm Circles reuses squat helpers + adds two polar-coordinate helpers used
// nowhere else in the codebase. Both are pure functions for unit-testability.
import type { NormalizedLandmark } from '@/modules/pose/types';

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

/** Runtime floor on bodyHeight — chair-pose / front-raise pattern. Side-view
 *  distance reference (shoulderWidth collapses in side view). The engine
 *  doesn't use this as a divisor (polar math is geometric); the calibration
 *  consumes it for the Fix-X cal-side rejection. */
export const MIN_BODY_HEIGHT_RUNTIME = 0.30;

/**
 * Polar position of wrist around shoulder.
 *   radius  — Euclidean distance from shoulder to wrist (normalized coords)
 *   angleRad — atan2 of (wrist - shoulder), range (-π, +π]
 *
 * Y-axis convention: MediaPipe Y is inverted (positive = down), so:
 *   - arm pointing forward (right in side view, +X): angleRad ≈ 0
 *   - arm pointing down (+Y): angleRad ≈ +π/2
 *   - arm pointing backward (-X): angleRad ≈ ±π
 *   - arm pointing up (-Y): angleRad ≈ -π/2
 *
 * Returns NaN-safe values: if shoulder and wrist coincide, radius=0 and
 * angle=0 (caller checks radius before using angle).
 */
export function polarAngleAroundShoulder(
  wrist: NormalizedLandmark,
  shoulder: NormalizedLandmark,
): { angleRad: number; radius: number } {
  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const radius = Math.hypot(dx, dy);
  if (radius < 1e-6) return { angleRad: 0, radius: 0 };
  return { angleRad: Math.atan2(dy, dx), radius };
}

/**
 * Shortest signed angular delta from prev to curr (in radians).
 * Used to unwrap atan2's discontinuity at ±π — a delta of e.g. +0.1 across
 * the boundary (from +π - 0.05 to -π + 0.05) should read as +0.1, not as
 * -(2π - 0.1).
 *
 * Returns a value in [-π, +π].
 */
export function unwrapAngleDelta(prevRad: number, currRad: number): number {
  let delta = currRad - prevRad;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}
