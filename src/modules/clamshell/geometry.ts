import type { PoseLandmarks } from '@/modules/pose/types';

export const LM = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
} as const;

export function lmVisible(lm: { visibility?: number }): boolean {
  return (lm.visibility ?? 0) > 0.5;
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Determine which side is on the floor (bottom) based on hip Y position.
 *  In normalized coords: floor = high Y. Bottom hip = higher Y = on floor.
 */
export function detectBottomSide(
  leftHip: { y: number },
  rightHip: { y: number },
): 'left' | 'right' {
  return leftHip.y > rightHip.y ? 'left' : 'right';
}

/** Compute current knee abduction fraction.
 *  Returns: (bottomKneeY - topKneeY - kneeGapBaseline) / hipGap
 *  Positive when the top knee has risen above its resting position.
 */
export function kneeAbductionFrac(
  bottomKneeY: number,
  topKneeY: number,
  kneeGapBaseline: number,
  hipGap: number,
): number {
  if (hipGap <= 0) return 0;
  return (bottomKneeY - topKneeY - kneeGapBaseline) / hipGap;
}

// Re-export PoseLandmarks for internal use
export type { PoseLandmarks };
