// Tandem Stand reuses squat's helpers (LM indices, lmVisible, midpoint,
// trunkLeanDeg) and adds the BB5-spec CoM proxy.
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

/**
 * Center-of-Mass proxy per BB5 spec — weighted average of hip + shoulder
 * midpoints, hip-weighted (0.6 hip + 0.4 shoulder) because the body's actual
 * CoM is closer to the pelvis than the shoulders. Used as the PRIMARY sway
 * signal: low-frequency motion of this point is the user's postural drift.
 */
export function comProxy(
  leftShoulder: NormalizedLandmark,
  rightShoulder: NormalizedLandmark,
  leftHip: NormalizedLandmark,
  rightHip: NormalizedLandmark,
): { x: number; y: number } {
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;
  return {
    x: hipMidX * 0.6 + shoulderMidX * 0.4,
    y: hipMidY * 0.6 + shoulderMidY * 0.4,
  };
}
