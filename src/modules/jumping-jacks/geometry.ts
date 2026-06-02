// Jumping Jacks reuses squat helpers for landmark indices, visibility, midpoint.
// The exercise-specific helpers below compute the two openness signals — arm
// (wrists above shoulders) and leg (feet apart) — both as percentages of
// shoulder width with a Fix-X runtime floor.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

/** Runtime floor on shoulderWidth used as the openness normalization divisor
 *  (Fix X). Matches `MIN_SHOULDER_WIDTH` at calibration time. */
export const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

/**
 * Arm openness — how far the AVERAGED wrist Y sits ABOVE the shoulder Y,
 * normalized by shoulder width.
 *   = 0 when wrists are at or below shoulders (arms down)
 *   ≈ 100 when wrists are one shoulder-width above (arms overhead)
 *
 * Y is inverted in MediaPipe normalized coords (smaller Y = higher in frame),
 * so the calculation is `(shoulderY - wristY)`, clamped to non-negative.
 */
export function armOpennessPct(
  shoulderY: number,
  avgWristY: number,
  shoulderW: number,
): number {
  const w = Math.max(shoulderW, MIN_SHOULDER_WIDTH_RUNTIME);
  return Math.max(0, ((shoulderY - avgWristY) / w) * 100);
}

/**
 * Leg openness — horizontal distance between left and right ankles, as a
 * percent of shoulder width.
 *   ≈ 30-50 when feet are hip-width or closer (CLOSED position)
 *   ≈ 100+ when feet are one shoulder-width apart (OPEN position)
 */
export function legOpennessPct(
  leftAnkleX: number,
  rightAnkleX: number,
  shoulderW: number,
): number {
  const w = Math.max(shoulderW, MIN_SHOULDER_WIDTH_RUNTIME);
  return (Math.abs(leftAnkleX - rightAnkleX) / w) * 100;
}

/**
 * Per-side arm openness — how far ONE wrist sits above ITS shoulder, as a
 * percent of shoulder width. Used for unilateral-rejection symmetry check.
 */
export function perSideArmOpennessPct(
  shoulderY: number,
  wristY: number,
  shoulderW: number,
): number {
  const w = Math.max(shoulderW, MIN_SHOULDER_WIDTH_RUNTIME);
  return Math.max(0, ((shoulderY - wristY) / w) * 100);
}

/**
 * Per-side ankle offset from body center — |ankle.x − bodyCenterX| as a
 * percent of shoulder width. Used for unilateral-rejection symmetry check
 * on the leg axis (one foot stepped out, other didn't).
 */
export function perSideAnkleOffsetPct(
  ankleX: number,
  bodyCenterX: number,
  shoulderW: number,
): number {
  const w = Math.max(shoulderW, MIN_SHOULDER_WIDTH_RUNTIME);
  return (Math.abs(ankleX - bodyCenterX) / w) * 100;
}
