/**
 * Tree Pose scoring — same hip-tilt + sway penalty primitives as SLS,
 * plus a foot-off-leg penalty unique to Tree Pose.
 */
export { getSwayPenalty } from '@/modules/tandem-stand/scoring';
export { getHipTiltPenalty } from '@/modules/single-leg-stand/scoring';

/**
 * Foot-off-leg penalty — the lifted-foot ankle should stay near the
 * standing-knee X. Beyond the warning threshold (0.06), penalize
 * proportionally up to a 25-point cap.
 */
export function getFootOffLegPenalty(footOffLegDistance: number): number {
  const excess = Math.max(0, footOffLegDistance - 0.06);
  return Math.min(25, excess * 250);
}
