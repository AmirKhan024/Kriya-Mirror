/**
 * Pallof Press scoring.
 *
 * MQS formula:
 *   baseScore = 100
 *   - torsoRotationPenalty  (each 'torso-rotation-pallof' warning  = -5)
 *   - incompletePenalty     (each 'incomplete-pallof-press' warning = -4)
 *   - otherWarningPenalty   (each other warning                     = -3)
 *   + holdBonus             (avgHoldMsPerRep: each 500ms above 1000ms adds 2pts, capped at +10)
 *   MQS = clamp(baseScore, 0, 100)
 */
import type { WarningType } from '@/store/workout';

export interface PallofPressRepStats {
  warnings: WarningType[];
  holdMs: number;            // accumulatedValidHoldMs for this rep
}

export function computeRepMqs(stats: PallofPressRepStats): number {
  let score = 100;

  for (const w of stats.warnings) {
    if (w === 'torso-rotation-pallof') {
      score -= 5;
    } else if (w === 'incomplete-pallof-press') {
      score -= 4;
    } else {
      score -= 3;
    }
  }

  // Hold bonus: each full 500ms above the 1000ms baseline adds 2 pts, max +10
  const excessMs = Math.max(0, stats.holdMs - 1000);
  const bonusSteps = Math.floor(excessMs / 500);
  const holdBonus = Math.min(10, bonusSteps * 2);
  score += holdBonus;

  return Math.max(0, Math.min(100, score));
}

/** Session-level MQS: simple average of per-rep MQS values. */
export function computeSessionMqs(repMqs: number[]): number {
  if (repMqs.length === 0) return 0;
  return Math.round(repMqs.reduce((s, v) => s + v, 0) / repMqs.length);
}
