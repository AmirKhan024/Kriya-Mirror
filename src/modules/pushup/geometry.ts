import type { NormalizedLandmark } from '@/modules/pose/types';

export { LM, VIS_THRESHOLD, lmVisible, allVisible, dist, midpoint } from '@/modules/squat/geometry';

/**
 * Elbow flexion in degrees. 0 = arm fully extended, 90 = right-angle bend,
 * 150+ = arm fully folded. Same `atan2(cross, dot)` convention as kneeFlexionDeg:
 * angle at the elbow vertex between (elbow→shoulder) and (elbow→wrist) vectors,
 * then converted to "flexion" = 180° − interior angle.
 */
export function elbowFlexionDeg(
  shoulder: NormalizedLandmark,
  elbow: NormalizedLandmark,
  wrist: NormalizedLandmark,
): number {
  const ux = shoulder.x - elbow.x;
  const uy = shoulder.y - elbow.y;
  const vx = wrist.x - elbow.x;
  const vy = wrist.y - elbow.y;
  const dot = ux * vx + uy * vy;
  const cross = Math.abs(ux * vy - uy * vx);
  const angleAtElbow = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.max(0, Math.min(180, 180 - angleAtElbow));
}
