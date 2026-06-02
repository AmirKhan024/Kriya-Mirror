import type { NormalizedLandmark, PoseLandmarks } from '@/modules/pose/types';

/** MediaPipe BlazePose landmark indices used by the glute-bridge engine. */
export const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
} as const;

export function lmVisible(lm: NormalizedLandmark): boolean {
  return (lm.visibility ?? 0) > 0.5;
}

export function midpoint(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Returns the mid-point of a joint using whichever landmarks are visible.
 * Falls back to single-side if only one is visible.
 */
export function jointMid(
  landmarks: PoseLandmarks,
  leftIdx: number,
  rightIdx: number,
): { x: number; y: number } | null {
  const l = landmarks[leftIdx];
  const r = landmarks[rightIdx];
  const lv = lmVisible(l);
  const rv = lmVisible(r);
  if (lv && rv) return midpoint(l, r);
  if (lv) return { x: l.x, y: l.y };
  if (rv) return { x: r.x, y: r.y };
  return null;
}
