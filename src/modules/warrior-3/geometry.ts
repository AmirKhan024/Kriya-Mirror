// Warrior III reuses squat's helpers (LM indices, lmVisible, midpoint, dist,
// kneeFlexionDeg). It adds one helper: the angle of a body segment from
// HORIZONTAL — the core metric for the airplane "T" (torso + back leg should
// both lie near horizontal; the standing leg near vertical).
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  kneeFlexionDeg,
} from '@/modules/squat/geometry';

interface Point { x: number; y: number }

/**
 * Angle of the segment from `a` to `b` measured from the HORIZONTAL axis, in
 * degrees [0, 90]. 0° = perfectly horizontal, 90° = perfectly vertical. Sign of
 * the direction is ignored (uses |dx|, |dy|) — we only care how level a segment
 * is, not which way it points. Accepts landmarks or midpoints.
 */
export function angleFromHorizontalDeg(a: Point, b: Point): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return Math.atan2(dy, dx) * (180 / Math.PI);
}
