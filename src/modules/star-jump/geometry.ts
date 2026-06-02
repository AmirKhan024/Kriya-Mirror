// Star Jump geometry — re-exports shared helpers + adds torso swing delta.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
} from '@/modules/squat/geometry';

/**
 * Horizontal displacement of shoulder midpoint from baseline.
 * Positive value; > TORSO_SWING_THRESHOLD indicates unwanted body sway.
 */
export function torsoSwingDelta(
  currentShoulderMidX: number,
  baselineShoulderMidX: number,
): number {
  return Math.abs(currentShoulderMidX - baselineShoulderMidX);
}
