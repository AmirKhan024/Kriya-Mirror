/**
 * Triangle Pose (front-on view) reuses squat's helpers (LM indices, lmVisible,
 * midpoint, kneeFlexionDeg) plus two triangle-specific helpers:
 *   - topArmDeviationDeg: angle between shoulder→wrist vector and TRUE VERTICAL
 *   - bottomArmFromAnkleY: signed normalized vertical distance between the
 *     bottom-hand wrist and the front-foot ankle
 */
import type { NormalizedLandmark } from '@/modules/pose/types';

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  kneeFlexionDeg,
} from '@/modules/squat/geometry';

/** Angle in degrees between the shoulder→wrist vector and TRUE VERTICAL
 *  (pointing UP toward the top of the frame, i.e. -Y direction). 0 = arm is
 *  perfectly vertical above the shoulder; 90 = arm horizontal; 180 = arm
 *  pointing straight down. */
export function topArmDeviationDeg(
  shoulder: NormalizedLandmark,
  wrist: NormalizedLandmark,
): number {
  const dx = wrist.x - shoulder.x;
  const dy = shoulder.y - wrist.y; // positive when wrist is ABOVE shoulder
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return 0;
  if (dy <= 0) {
    // Wrist below shoulder: angle past 90°.
    return 90 + Math.atan2(Math.abs(dx) <= 1e-4 ? 0 : -dy, Math.abs(dx)) * (180 / Math.PI);
  }
  return Math.atan2(Math.abs(dx), dy) * (180 / Math.PI);
}

/** Signed normalized vertical distance between the bottom-hand wrist and the
 *  front-foot ankle. ≤ 0 = wrist below the ankle (ideal triangle reach).
 *  Positive = wrist is ABOVE the ankle (bottom hand not reaching the foot).
 *  Normalized by bodyHeight (with a small floor to avoid div-by-zero). */
export function bottomArmFromAnkleY(
  bottomWrist: NormalizedLandmark,
  frontAnkle: NormalizedLandmark,
  bodyHeight: number,
): number {
  const bh = Math.max(bodyHeight, 0.10);
  return (frontAnkle.y - bottomWrist.y) / bh;
}
