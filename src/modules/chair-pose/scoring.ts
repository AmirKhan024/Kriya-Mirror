/**
 * Chair Pose scoring. Mirrors plank's pattern:
 *  - Completion score: how close `actualValidHoldSec` came to `targetSec`.
 *  - Form score: average MQS across all 1Hz samples (computed in store).
 *  - Final = completion × 0.40 + form × 0.60 (form weighted higher since the
 *    whole exercise IS form).
 */

export function getHoldCompletionScore(actualSec: number, targetSec: number): number {
  if (targetSec <= 0) return 0;
  const ratio = actualSec / targetSec;
  if (ratio >= 1.0) return 100;
  if (ratio >= 0.75) return 85;
  if (ratio >= 0.50) return 70;
  if (ratio >= 0.25) return 50;
  return 25;
}

export function getFinalMqs(completionScore: number, averageFormScore: number): number {
  return Math.round(completionScore * 0.40 + averageFormScore * 0.60);
}
