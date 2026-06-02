/**
 * Curtsy Lunge scoring.
 *
 * MQS formula:
 *   baseScore = 100
 *   - warningPenalty (each 'incomplete-curtsy-lunge' = -5, each other warning = -3)
 *   + depthBonus (avg peakDepthDeg: each degree below 95° adds 0.5 pts, capped at +10)
 *   MQS = clamp(baseScore, 0, 100)
 *
 * Reuses smoothness and form helpers from squat/scoring (same MQS shape).
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

import type { WarningType } from '@/store/workout';

/**
 * Form score for curtsy lunge — uses trunk and knee adherence counts.
 */
export function getFormScore(form: {
  kneeOKCount: number;
  trunkOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const kneePct = form.kneeOKCount / form.totalCount;
  const trunkPct = form.trunkOKCount / form.totalCount;
  return Math.round((kneePct + trunkPct) * 50);  // average of two, scaled 0–100
}

/**
 * Compute curtsy lunge MQS with depth bonus.
 *
 * @param peakDepthDeg  Front knee angle at deepest point (lower = deeper). 90 = deep curtsy.
 * @param warnings      All warnings recorded during the rep.
 * @param smoothness    From getSmoothnessScore().
 * @param form          From getFormScore().
 */
export function computeCurtsyMQS(
  peakDepthDeg: number,
  warnings: WarningType[],
  smoothness: number,
  form: number,
): number {
  let baseScore = 100;

  // Warning penalties
  for (const w of warnings) {
    if (w === 'incomplete-curtsy-lunge') {
      baseScore -= 5;
    } else {
      baseScore -= 3;
    }
  }

  // Depth bonus: each degree below 95° adds 0.5 pts, capped at +10
  const depthBonus = Math.min(10, Math.max(0, (95 - peakDepthDeg) * 0.5));
  baseScore += depthBonus;

  // Blend in smoothness and form (minor weight)
  const blended = baseScore * 0.7 + smoothness * 0.15 + form * 0.15;

  return Math.round(Math.max(0, Math.min(100, blended)));
}

/**
 * Completion score component based on front-knee angle (lower = better).
 * Maps the range [180° standing → 90° deep] onto [0 → 100].
 */
export function getCompletionScore(peakDepthDeg: number): number {
  // 90° → 100 pts, 120° → 67 pts, 155° → 28 pts (scaled from 90–155 range)
  const BEST = 90;
  const WORST = 155;
  const pct = Math.max(0, Math.min(1, (WORST - peakDepthDeg) / (WORST - BEST)));
  return Math.round(pct * 100);
}
