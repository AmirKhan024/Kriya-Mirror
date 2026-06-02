/**
 * Walking Lunge scoring mirrors lunge/squat: completion is keyed to front-knee
 * flexion bands (same shape, same tiers), smoothness from hip-Y velocity CV,
 * form from per-frame adherence counts.
 *
 * Front-knee flexion in a deep walking lunge typically reaches ~90° at the
 * bottom (front thigh parallel to floor). 60° is the depth floor (step counts).
 */
export {
  getSmoothnessScore,
  getCompletionScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/**
 * Form score for walking lunge — drops squat's heel-OK count and adds a
 * knee-past-toe count slot. Same overall shape: average of three adherence
 * percentages.
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
