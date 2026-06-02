/**
 * Shrug scoring — same MQS formula as hammer curl:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak shoulder elevation. */
export function getCompletionScore(peakElevation: number): number {
  if (peakElevation >= 0.070) return 100;
  if (peakElevation >= 0.055) return 85;
  if (peakElevation >= 0.045) return 70;
  if (peakElevation >= 0.035) return 55;   // floor — below 0.035 fails MIN_SHRUG_HEIGHT
  if (peakElevation >= 0.020) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during the active shrug phases. */
export function getFormScore(form: {
  torsoOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const torsoPct = form.torsoOKCount / form.totalCount;
  return Math.round(torsoPct * 100);
}
