/**
 * Mountain Climber scoring — mirrors pushup/scoring.ts pattern.
 */

interface FormCounts {
  hipOKCount: number;
  totalCount: number;
}

/**
 * Smoothness score (0–100) based on shoulder/knee velocity samples.
 * Low variance = smooth movement = high score.
 */
export function getSmoothnessScore(velocities: number[]): number {
  if (velocities.length === 0) return 80;
  const absVels = velocities.map(Math.abs);
  const avg = absVels.reduce((s, v) => s + v, 0) / absVels.length;
  // Mountain climbers are fast — higher baseline velocity is normal
  // Map avg 0→100: avg=0 → 100, avg=4 → 0
  const score = Math.max(0, 100 - (avg / 4) * 100);
  return Math.min(100, score);
}

/**
 * Form score (0–100): fraction of frames where hip was in plank line.
 */
export function getFormScore(counts: FormCounts): number {
  if (counts.totalCount === 0) return 80;
  return (counts.hipOKCount / counts.totalCount) * 100;
}

/**
 * Completion score (0–100): how deeply the knee was driven (lower angle = better).
 * KNEE_PEAK_DEG=70 is the target minimum. angleAtPeak should be ≤70 for full score.
 */
export function getCompletionScore(peakAngleDeg: number): number {
  // Angle DECREASES as knee drives deeper. Lower angle = better rep.
  // Reference: plank=170°, target=70°. Score linearly between 70° and 120°.
  const FULL_SCORE_ANGLE = 60;   // at 60° or lower → 100
  const ZERO_SCORE_ANGLE = 130;  // at 130° or above → 0
  if (peakAngleDeg <= FULL_SCORE_ANGLE) return 100;
  if (peakAngleDeg >= ZERO_SCORE_ANGLE) return 0;
  return ((ZERO_SCORE_ANGLE - peakAngleDeg) / (ZERO_SCORE_ANGLE - FULL_SCORE_ANGLE)) * 100;
}

/**
 * Master Quality Score (0–100): weighted blend.
 */
export function computeMQS(components: {
  smoothness: number;
  form: number;
  completion: number;
}): number {
  // Weights: completion 40%, form 40%, smoothness 20%
  return components.completion * 0.40
    + components.form * 0.40
    + components.smoothness * 0.20;
}
