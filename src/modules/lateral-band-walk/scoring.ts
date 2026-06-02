import type { WarningType } from '@/store/workout';

/**
 * Compute Movement Quality Score (MQS) for a Lateral Band Walk session.
 *
 * Formula:
 *   baseScore = 100
 *   - trunkLeanPenalty   (each 'trunk-lean' warning = -4 pts)
 *   - hipDropPenalty     (each 'hip-drop' warning = -4 pts)
 *   - outOfFramePenalty  (each 'steps-not-tracked' = -6 pts — severe, means reps were lost)
 *   - otherPenalty       (each other warning = -3 pts)
 *   + cadenceBonus       (if avg step speed < 1200ms → +5 pts for good rhythm)
 *   MQS = clamp(baseScore, 0, 100)
 */
export function computeMQS(
  warnings: WarningType[],
  stepCount: number,
  totalDurationMs: number,
): number {
  let score = 100;

  for (const w of warnings) {
    if (w === 'trunk-lean') {
      score -= 4;
    } else if (w === 'hip-drop') {
      score -= 4;
    } else if (w === 'steps-not-tracked') {
      score -= 6;
    } else {
      score -= 3;
    }
  }

  // Cadence bonus: average step speed < 1200ms
  if (stepCount > 0) {
    const avgStepMs = totalDurationMs / stepCount;
    if (avgStepMs < 1200) {
      score += 5;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/** Per-step MQS: used when scoring individual steps. */
export function computeStepMQS(stepWarnings: WarningType[], durationMs: number): number {
  let score = 100;

  for (const w of stepWarnings) {
    if (w === 'trunk-lean') {
      score -= 4;
    } else if (w === 'hip-drop') {
      score -= 4;
    } else if (w === 'steps-not-tracked') {
      score -= 6;
    } else {
      score -= 3;
    }
  }

  // Cadence bonus
  if (durationMs < 1200) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}
