/**
 * Mirrors C:\Users\Amir Khan\Desktop\kriya-activities\mobility_new\deep_squat_descend\js\scoring.js
 *
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 * DCI = 100 − stddev(maxFlexions per rep) × 2
 */

/** Completion sub-score per rep, by max knee flexion angle. */
export function getCompletionScore(maxFlexionDeg: number): number {
  if (maxFlexionDeg >= 120) return 100;
  if (maxFlexionDeg >= 90) return 75;
  if (maxFlexionDeg >= 60) return 50;
  if (maxFlexionDeg >= 30) return 25;
  return 0;
}

/**
 * Smoothness sub-score from hip-Y velocities (lower CV = smoother).
 * Returns 0–100.
 */
export function getSmoothnessScore(hipVelocities: number[]): number {
  if (hipVelocities.length < 4) return 50;
  const mean = hipVelocities.reduce((a, b) => a + Math.abs(b), 0) / hipVelocities.length;
  if (mean === 0) return 50;
  const variance =
    hipVelocities.reduce((s, v) => s + Math.pow(Math.abs(v) - mean, 2), 0) /
    hipVelocities.length;
  const cv = Math.sqrt(variance) / mean;
  // CV ≤ 0.3 → 100, 0.5 → 85, 0.7 → 70, 1.0 → 50, 1.5 → 30, >1.5 → 15
  if (cv <= 0.3) return 100;
  if (cv <= 0.5) return 85;
  if (cv <= 0.7) return 70;
  if (cv <= 1.0) return 50;
  if (cv <= 1.5) return 30;
  return 15;
}

/**
 * Form sub-score from per-rep adherence counts (heel down, knees out, trunk upright).
 * Returns 0–100.
 */
export function getFormScore(form: {
  heelOKCount: number;
  kneeOKCount: number;
  trunkOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const heelPct = form.heelOKCount / form.totalCount;
  const kneePct = form.kneeOKCount / form.totalCount;
  const trunkPct = form.trunkOKCount / form.totalCount;
  return Math.round((heelPct + kneePct + trunkPct) * (100 / 3));
}

export interface MqsComponents {
  smoothness: number;
  form: number;
  completion: number;
}

export function computeMQS(c: MqsComponents): number {
  return c.smoothness * 0.35 + c.form * 0.4 + c.completion * 0.25;
}

/** DCI = depth consistency across reps. Returns 0–100. */
export function calculateDCI(repMaxFlexions: number[]): number {
  if (!repMaxFlexions || repMaxFlexions.length < 2) return 50;
  const n = repMaxFlexions.length;
  const mean = repMaxFlexions.reduce((a, b) => a + b, 0) / n;
  const variance = repMaxFlexions.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);
  return Math.max(0, Math.min(100, 100 - stddev * 2));
}
