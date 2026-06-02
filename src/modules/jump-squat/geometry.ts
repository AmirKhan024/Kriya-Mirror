/**
 * Jump Squat geometry helpers — front-facing camera.
 * Reuses MediaPipe landmark indices from squat.
 */
import type { NormalizedLandmark } from '@/modules/pose/types';

export const LM = {
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
} as const;

export function lmVisible(lm: NormalizedLandmark): boolean {
  return (lm?.visibility ?? 0) > 0.5;
}

export function midpoint(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Knee flexion in degrees. 0 = fully straight, ~150 = deep bend.
 *  Computed as 180° − (angle at knee) using vectors FROM knee TO hip and FROM knee TO ankle.
 *  Mirrors squat/geometry.ts exactly so both engines agree on the same value. */
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
