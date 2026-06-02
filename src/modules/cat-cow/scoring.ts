/**
 * Cat-Cow scoring — reuses the shared smoothness + MQS primitives (35/40/25
 * weights), with a completion sub-score on the TOTAL spinal range of a cycle
 * (peak extension + peak flexion) and a form sub-score on hip stability (the
 * pelvis shouldn't rock forward/back through the movement).
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion by the total cat-cow range (degrees of head-pitch swing). The
 *  rep floor (cow ≥ 15 + cat ≥ 15) gives ~30°; a full, expressive cat-cow
 *  swings ~50°+. */
export function getCompletionScore(totalRangeDeg: number): number {
  if (totalRangeDeg >= 50) return 100;
  if (totalRangeDeg >= 40) return 85;
  if (totalRangeDeg >= 30) return 70;
  return 0;
}

/** Form score from per-frame hip-stability adherence (pelvis stays over the
 *  knees rather than rocking back and forth). */
export function getFormScore(form: { hipsStableCount: number; totalCount: number }): number {
  if (form.totalCount === 0) return 50;
  return Math.round((form.hipsStableCount / form.totalCount) * 100);
}
