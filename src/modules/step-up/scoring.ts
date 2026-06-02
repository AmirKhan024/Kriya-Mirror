/**
 * Step-Up scoring helpers.
 *
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 * Completion is based on max hip upward displacement (MIN_RISE = 0.10, FULL_RISE = 0.18).
 */

export function getCompletionScore(peakRise: number): number {
  const MIN_RISE = 0.10;
  const FULL_RISE = 0.18;
  if (peakRise >= FULL_RISE) return 100;
  if (peakRise >= 0.15) return 85;
  if (peakRise >= 0.12) return 70;
  if (peakRise >= MIN_RISE) return 50;
  if (peakRise >= 0.06) return 25;
  return 0;
}

/**
 * Smoothness sub-score from hip-Y velocities during the step cycle.
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
 * Form sub-score — tracks valgus-free frames during the step.
 * Returns 0–100.
 */
export function getFormScore(form: {
  valgusOkCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const ratio = form.valgusOkCount / form.totalCount;
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
