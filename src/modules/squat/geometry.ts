import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';

export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export const VIS_THRESHOLD = 0.3;

export function lmVisible(lm: NormalizedLandmark | undefined): boolean {
  return !!lm && (lm.visibility ?? 0) >= VIS_THRESHOLD;
}

export function allVisible(landmarks: PoseLandmarks, indices: number[]): boolean {
  return indices.every((i) => lmVisible(landmarks[i]));
}

export function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function midpoint(a: NormalizedLandmark, b: NormalizedLandmark) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Knee flexion in degrees. 0 = fully straight, ~150 = deep squat.
 * Computed as 180° − (angle at the knee).
 */
export function kneeFlexionDeg(
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
  ankle: NormalizedLandmark,
): number {
  const ux = hip.x - knee.x;
  const uy = hip.y - knee.y;
  const vx = ankle.x - knee.x;
  const vy = ankle.y - knee.y;
  const dot = ux * vx + uy * vy;
  const cross = Math.abs(ux * vy - uy * vx);
  const angleAtKnee = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.max(0, Math.min(180, 180 - angleAtKnee));
}

/**
 * Trunk lean (combined proxy): how far shoulder midpoint has tipped forward of hip midpoint
 * relative to torso height. 0 = perfectly upright, ~90 = horizontal.
 */
export function trunkLeanDeg(
  shoulderMid: { x: number; y: number },
  hipMid: { x: number; y: number },
): number {
  const dx = shoulderMid.x - hipMid.x;
  const dy = hipMid.y - shoulderMid.y; // positive when shoulders above hips (normal)
  if (dy <= 0.0001) return 90;
  return Math.atan2(Math.abs(dx), dy) * (180 / Math.PI);
}
