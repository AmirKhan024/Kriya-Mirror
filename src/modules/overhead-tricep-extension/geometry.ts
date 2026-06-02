// Overhead Tricep Extension reuses squat's landmark helpers and adds a
// custom depth metric suited to the overhead position.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

import type { NormalizedLandmark } from '@/modules/pose/types';

/**
 * Tricep extension depth for one arm, computed from the front camera.
 *
 * Convention: in normalised image-space y increases downward.
 * For an overhead extended arm: elbow.y < shoulder.y (elbow is above shoulder).
 * Wrist is above elbow when arms are straight: wrist.y < elbow.y.
 *
 * The metric = (elbow.y − wrist.y) / upperArmLen × 90
 *   ≈ 90°  → arms fully extended (wrist one full upper-arm-length above elbow)
 *   ≈  0°  → forearm horizontal (wrist has dropped to elbow level)
 *   Negative → forearm has swung past horizontal (wrist below elbow)
 *
 * upperArmLen is captured at calibration: (shoulder.y − elbow.y), the
 * distance by which the elbow sits above the shoulder in screen space.
 */
export function tricepExtDeg(
  elbow: NormalizedLandmark,
  wrist: NormalizedLandmark,
  upperArmLen: number,
): number {
  if (upperArmLen <= 0) return 0;
  return ((elbow.y - wrist.y) / upperArmLen) * 90;
}
