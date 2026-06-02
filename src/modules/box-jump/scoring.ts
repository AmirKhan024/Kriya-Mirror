/**
 * Box Jump scoring helpers.
 *
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 * For box jump: completion is based on max hip upward displacement (MIN_HIP_RISE = 0.06).
 */

export function getCompletionScore(maxHipRise: number): number {
  // maxHipRise is normalised Y units (positive = hip rose above baseline)
  if (maxHipRise >= 0.14) return 100;
  if (maxHipRise >= 0.10) return 75;
  if (maxHipRise >= 0.07) return 50;
  if (maxHipRise >= 0.04) return 25;
  return 0;
}

/**
 * Smoothness sub-score from hip-Y velocities collected during the jump cycle.
 * Lower CV = smoother / more controlled. Returns 0–100.
 */
export function getSmoothnessScore(hipVelocities: number[]): number {
  if (hipVelocities.length < 2) return 50;
  const abs = hipVelocities.map(Math.abs);
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  if (mean === 0) return 50;
  const variance = abs.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / abs.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv <= 0.3) return 100;
  if (cv <= 0.5) return 85;
  if (cv <= 0.7) return 70;
  if (cv <= 1.0) return 50;
  if (cv <= 1.5) return 30;
  return 15;
}

/**
 * Form sub-score from per-rep adherence counts.
 * Tracks whether landing had knee absorption (no stiff landing).
 * Returns 0–100.
 */
export function getFormScore(form: {
  softLandingCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const ratio = form.softLandingCount / form.totalCount;
  return Math.round(ratio * 100);
}

export interface MqsComponents {
  smoothness: number;
  form: number;
  completion: number;
}

export function computeMQS(c: MqsComponents): number {
  return c.smoothness * 0.35 + c.form * 0.40 + c.completion * 0.25;
}
