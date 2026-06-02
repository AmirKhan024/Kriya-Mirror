import type { NormalizedLandmark } from '@/modules/pose/types';

export { LM, VIS_THRESHOLD, lmVisible, allVisible, dist, midpoint } from '@/modules/squat/geometry';

/**
 * Returns deviation of hip from the expected plank body line.
 * Positive = hip is sagging below line. Negative = hip is piking above line.
 * Uses normalised frame coordinates.
 *
 * This is the line-relative metric: we compute where the hip SHOULD be on the
 * shoulder→ankle line (at the hip's X position), then measure how far it
 * deviates. Invariant to body height — same calculation as pushup engine.
 */
export function hipPlankDeviation(
  shoulderX: number,
  shoulderY: number,
  hipX: number,
  hipY: number,
  ankleX: number,
  ankleY: number,
): number {
  const ankleSpanX = ankleX - shoulderX;
  const expectedHipY = Math.abs(ankleSpanX) > 0.001
    ? shoulderY + ((hipX - shoulderX) / ankleSpanX) * (ankleY - shoulderY)
    : (shoulderY + ankleY) / 2;
  return hipY - expectedHipY;
}

/**
 * Hip-to-knee angle for mountain climber knee drive.
 * Measures the angle at the HIP vertex between vectors:
 *   hip → shoulder
 *   hip → knee
 * At full extension (PLANK): ~170° (vectors diverge widely)
 * At full drive (KNEE_AT_CHEST): ~30–60° (vectors converge)
 *
 * IMPORTANT: This function computes the INTERIOR angle, not a flexion supplement.
 * So values DECREASE as the knee drives toward the chest.
 */
export function kneeHipAngleDeg(
  shoulder: NormalizedLandmark,
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
): number {
  // Vector from hip to shoulder
  const v1x = shoulder.x - hip.x;
  const v1y = shoulder.y - hip.y;
  // Vector from hip to knee
  const v2x = knee.x - hip.x;
  const v2y = knee.y - hip.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (mag1 < 1e-6 || mag2 < 1e-6) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * 180) / Math.PI;
}
