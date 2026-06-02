export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score based on peak hip-rise fraction (0–1+). */
export function getCompletionScore(peakRiseFraction: number): number {
  if (peakRiseFraction >= 1.0) return 100;
  if (peakRiseFraction >= 0.80) return 75;
  if (peakRiseFraction >= 0.60) return 50;
  if (peakRiseFraction >= 0.40) return 25;
  return 0;
}

/** Form score based on fraction of frames without lower-back hyperextension. */
export function getFormScore(form: {
  archOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  return Math.round((form.archOKCount / form.totalCount) * 100);
}
