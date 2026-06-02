/**
 * Mountain Pose scoring — reuses tandem-stand's sway penalty + adds a
 * combined posture-deviation penalty.
 */
export { getSwayPenalty } from '@/modules/tandem-stand/scoring';

/**
 * Posture-deviation penalty — combined shoulder + hip + spine misalignment.
 * Above the warning threshold (0.30), penalize proportionally up to 35 points.
 */
export function getPosturePenalty(postureDeviation: number): number {
  const excess = Math.max(0, postureDeviation - 0.30);
  return Math.min(35, excess * 150);
}
