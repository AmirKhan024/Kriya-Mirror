/**
 * Pistol Squat scoring — completion keyed to standing-leg knee flexion bands
 * for a full pistol (hamstring-to-calf). 70° is minimum valid rep, 110°+ is excellent.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/**
 * Completion score for pistol squat based on depth achieved.
 * 70° = minimum valid rep (MIN_REP_DEPTH_DEG)
 * 90° = good depth (thigh parallel)
 * 110° = excellent (hamstring touching calf)
 */
export function getCompletionScore(peakDeg: number): number {
  if (peakDeg >= 110) return 100;
  if (peakDeg >= 90) return 80 + ((peakDeg - 90) / 20) * 20;
  if (peakDeg >= 70) return 50 + ((peakDeg - 70) / 20) * 30;
  return 30;
}

/**
 * Form score for pistol squat — from valgus/trunk OK frames.
 * Same shape as lunge: average of three adherence percentages.
 */
export function getFormScore(form: {
  kneeOKCount: number;
  trunkOKCount: number;
  kneeOverToeOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const kneePct = form.kneeOKCount / form.totalCount;
  const trunkPct = form.trunkOKCount / form.totalCount;
  const kneeToePct = form.kneeOverToeOKCount / form.totalCount;
  return Math.round((kneePct + trunkPct + kneeToePct) * (100 / 3));
}
