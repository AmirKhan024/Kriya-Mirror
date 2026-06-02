/**
 * OHP Scoring — mirrors squat's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is measured by how low the elbow flexion gets at lockout.
 * Lower flex = more extended = better lockout.
 *   ≤ 15° (near full lockout):  100
 *   ≤ 30°:  80
 *   ≤ 50°:  60
 *   ≤ 70°:  40
 *   ≤ 90°:  20
 *   > 90°: 0 (fails MIN_REP_DEPTH_DEG)
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/**
 * Completion sub-score per rep, by minimum (peak lockout) elbow flexion.
 * For OHP: minimum flex angle during the rep = best lockout achieved.
 * Arm fully extended overhead = ~10°–15° elbow flex residual.
 */
export function getCompletionScore(minElbowFlexDeg: number): number {
  if (minElbowFlexDeg <= 15) return 100;
  if (minElbowFlexDeg <= 30) return 80;
  if (minElbowFlexDeg <= 50) return 60;
  if (minElbowFlexDeg <= 70) return 40;
  if (minElbowFlexDeg <= 90) return 20;
  return 0;
}

/** Form score from per-frame adherence counts during pressing phases. */
export function getFormScore(form: {
  archOKCount: number;
  driftOKCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const archPct = form.archOKCount / form.totalCount;
  const driftPct = form.driftOKCount / form.totalCount;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round((archPct + driftPct + symPct) * (100 / 3));
}
