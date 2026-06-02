/**
 * Conventional Deadlift geometry helpers — side-camera, sagittal-plane view.
 *
 * Primary metric: `hipHingeDeg` — angle of hip flexion measured in the
 * shoulder-hip-knee triangle. Mirrors kneeFlexionDeg but pivoted at the hip:
 *   0° = standing upright (shoulder directly above hip above knee)
 *   ~80° = deep hip hinge (torso roughly horizontal)
 */
import type { NormalizedLandmark } from '@/modules/pose/types';

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
} from '@/modules/squat/geometry';

/**
 * Hip hinge angle in degrees (0 = standing, ~80 = deep hinge).
 * Computed as 180° − angle at hip in the shoulder-hip-knee triangle.
 * Mirrors the atan2(cross,dot) convention from kneeFlexionDeg so the
 * parallel-segment (standing) case correctly returns 0.
 */
export function hipHingeDeg(
  shoulder: NormalizedLandmark,
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
): number {
  // vectors FROM hip
  const ux = shoulder.x - hip.x;
  const uy = shoulder.y - hip.y;
  const vx = knee.x - hip.x;
  const vy = knee.y - hip.y;
  const dot = ux * vx + uy * vy;
  const cross = Math.abs(ux * vy - uy * vx);
  const angleAtHip = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.max(0, Math.min(180, 180 - angleAtHip));
}

/**
 * Torso inclination from vertical (0 = upright, 90 = horizontal) in degrees.
 * Computed from the shoulder-hip vector. Used to detect excessive forward lean.
 */
export function torsoAngleDeg(
  shoulder: NormalizedLandmark,
  hip: NormalizedLandmark,
): number {
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y; // positive when shoulder is above hip (normal)
  if (dy <= 0.0001) return 90;
  return Math.atan2(Math.abs(dx), dy) * (180 / Math.PI);
}
