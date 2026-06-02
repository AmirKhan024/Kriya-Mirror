// Lateral Raise reuses squat's helpers (LM indices, lmVisible, midpoint) and
// adds the shoulder-abduction angle helper specific to this exercise.
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
 * Shoulder-abduction angle in degrees. Measured as the angle at the shoulder
 * between (shoulder → hip) and (shoulder → wrist).
 *   At standing rest (arms hanging at sides): wrist below shoulder, hip below
 *     shoulder — both vectors point "down" → angle ≈ 0°.
 *   At arms parallel to floor: wrist out to the side at shoulder height,
 *     hip straight down → angle ≈ 90°.
 *   At arms overhead: wrist above, hip below → opposite directions ≈ 180°.
 *
 * Computed via atan2 of (cross, dot) so numerically stable across the full
 * 0–180° range.
 */
export function shoulderAbductionDeg(
  shoulder: NormalizedLandmark,
  wrist: NormalizedLandmark,
  hip: NormalizedLandmark,
): number {
  const ux = wrist.x - shoulder.x;
  const uy = wrist.y - shoulder.y;
  const vx = hip.x - shoulder.x;
  const vy = hip.y - shoulder.y;
  const dot = ux * vx + uy * vy;
  const crossAbs = Math.abs(ux * vy - uy * vx);
  return Math.atan2(crossAbs, dot) * (180 / Math.PI);
}
