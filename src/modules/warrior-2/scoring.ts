/**
 * Warrior II scoring — mirrors chair-pose / plank: completion 40% + form 60%.
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
