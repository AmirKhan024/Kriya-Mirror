import type { PoseLandmarks } from '@/modules/pose/types';

export const LM = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
} as const;

export function lmVisible(lm: { visibility?: number }): boolean {
  return (lm.visibility ?? 0) > 0.5;
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Trunk lean angle in degrees.
 *  = angle of (shoulder - hip) vector vs downward vertical.
 *  0° = upright; 90° = horizontal.
 */
export function trunkLeanDeg(
  shoulder: { x: number; y: number },
  hip: { x: number; y: number },
): number {
  const dy = hip.y - shoulder.y; // positive when shoulder above hip (normal)
  const dx = Math.abs(hip.x - shoulder.x);
  if (dy <= 0) return 90; // inverted — cap at 90
  return Math.atan2(dx, dy) * (180 / Math.PI);
}

/** Pick the camera-facing side based on visibility scores. */
export function pickActiveSide(landmarks: PoseLandmarks): 'left' | 'right' {
  const ls = landmarks[LM.LEFT_SHOULDER]?.visibility ?? 0;
  const rs = landmarks[LM.RIGHT_SHOULDER]?.visibility ?? 0;
  return rs >= ls ? 'right' : 'left';
}

/** Return landmarks for the active side. */
export function getSideLandmarks(landmarks: PoseLandmarks, side: 'left' | 'right') {
  const l = side === 'left';
  return {
    shoulder: landmarks[l ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER],
    hip: landmarks[l ? LM.LEFT_HIP : LM.RIGHT_HIP],
    knee: landmarks[l ? LM.LEFT_KNEE : LM.RIGHT_KNEE],
    ankle: landmarks[l ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE],
  };
}
