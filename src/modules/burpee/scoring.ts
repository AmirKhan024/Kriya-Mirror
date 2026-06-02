/**
 * Burpee scoring — mirrors squat/scoring.ts.
 * Completion score based on hip Y drop depth.
 * Smoothness based on hip Y velocities.
 * Form based on hip-sag frame counts.
 */

/** Completion sub-score: how much hip Y dropped (depth of burpee). */
export function getCompletionScore(maxHipYDrop: number): number {
  // maxHipYDrop is the maximum hipYOffset seen during the rep (positive = dropped)
  if (maxHipYDrop >= 0.14) return 100;  // reached plank position
  if (maxHipYDrop >= 0.10) return 75;
  if (maxHipYDrop >= 0.06) return 50;
  if (maxHipYDrop >= 0.03) return 25;
  return 0;
}

/**
 * Smoothness sub-score from hip-Y velocity samples.
 * Lower CV (coefficient of variation) = smoother = higher score.
 */
export function getSmoothnessScore(hipVelocities: number[]): number {
  if (hipVelocities.length < 4) return 50;
  const absVels = hipVelocities.map(Math.abs);
  const mean = absVels.reduce((a, b) => a + b, 0) / absVels.length;
  if (mean === 0) return 50;
  const variance = absVels.reduce((s, v) => s + (v - mean) ** 2, 0) / absVels.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv <= 0.3) return 100;
  if (cv <= 0.5) return 85;
  if (cv <= 0.7) return 70;
  if (cv <= 1.0) return 50;
  if (cv <= 1.5) return 30;
  return 15;
}

/** Form sub-score from per-rep adherence (no hip-sag during plank). */
export function getFormScore(form: {
  hipSagOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 75; // no plank frames = no form data
  const sagPct = form.hipSagOKCount / form.totalCount;
  return Math.round(sagPct * 100);
}

export interface MqsComponents {
  smoothness: number;
  form: number;
  completion: number;
}

export function computeMQS(c: MqsComponents): number {
  return c.smoothness * 0.35 + c.form * 0.40 + c.completion * 0.25;
}
