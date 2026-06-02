/**
 * Overhead Tricep Extension scoring.
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Depth is expressed as how far the wrists dropped from full extension.
 * depthDeg = 90 − (minimum tricepExtDeg reached during the rep).
 *   90° = wrists reached elbow level (perfect ROM)
 *   50° = wrists got halfway down (minimum valid)
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by depth achieved. */
export function getCompletionScore(depthDeg: number): number {
  if (depthDeg >= 80) return 100;
  if (depthDeg >= 70) return 85;
  if (depthDeg >= 60) return 70;
  if (depthDeg >= 50) return 55;
  if (depthDeg >= 30) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during active extension phases. */
export function getFormScore(form: {
  elbowOKCount: number;
  torsoOKCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const elbowPct = form.elbowOKCount / form.totalCount;
  const torsoPct = form.torsoOKCount / form.totalCount;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round((elbowPct + torsoPct + symPct) * (100 / 3));
}
