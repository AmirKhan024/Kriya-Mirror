// Boat Pose reuses squat's helpers (LM indices, lmVisible, midpoint) and the
// angle-from-horizontal helper (the same metric warrior-3 uses): the torso and
// the legs should both lift toward the V.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  midpoint,
} from '@/modules/squat/geometry';

interface Point { x: number; y: number }

/**
 * Angle of the segment from `a` to `b` measured from the HORIZONTAL axis, in
 * degrees [0, 90]. 0° = horizontal, 90° = vertical. Direction sign ignored
 * (uses |dx|, |dy|). Accepts landmarks or midpoints.
 */
export function angleFromHorizontalDeg(a: Point, b: Point): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return Math.atan2(dy, dx) * (180 / Math.PI);
}
