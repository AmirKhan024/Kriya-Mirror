// Standing Oblique Side Bend reuses squat helpers for landmark indices,
// visibility, midpoint. The exercise-specific helper computes the lateral
// torso lean angle (frontal plane) with a per-frame outlier clamp before EMA.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
} from '@/modules/squat/geometry';

/** Runtime floor on shoulderWidth used as the distance/normalization divisor
 *  (Fix X). Matches `MIN_SHOULDER_WIDTH` at calibration time. */
export const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

/**
 * Lateral torso lean MAGNITUDE in degrees — how far the spine has tipped to the
 * side in the frontal (camera) plane. Computed as the angle of the
 * hipMid→shoulderMid vector from straight-up vertical.
 *
 *   standing upright (shoulders directly above hips) → ~0°
 *   bent to one side                                  → grows toward 90°
 *
 * The CALLER reads the sign of (shoulderMid.x − hipMid.x) to decide which way
 * the bend goes (left vs right). This returns magnitude only. Frontal plane
 * (x/y) — the axis MediaPipe tracks most reliably.
 */
export function lateralLeanDeg(
  shoulderMid: { x: number; y: number },
  hipMid: { x: number; y: number },
): number {
  const dx = Math.abs(shoulderMid.x - hipMid.x);
  const dy = hipMid.y - shoulderMid.y; // positive when shoulders are above hips (normal)
  if (dy <= 0.0001) return 90; // torso horizontal or inverted
  return Math.atan2(dx, dy) * (180 / Math.PI);
}

/**
 * Per-frame outlier clamp on the raw lean angle, BEFORE EMA smoothing. Mirrors
 * side-leg-raise's clampAbductionDelta. A genuine fast side bend moves
 * ~2–3°/frame at 30 fps; MediaPipe spikes can be larger. 6°/frame allows real
 * motion while killing single-frame jitter.
 */
const MAX_LEAN_DELTA_PER_FRAME = 6;
export function clampLeanDelta(rawDeg: number, prevSmoothedDeg: number): number {
  const delta = rawDeg - prevSmoothedDeg;
  if (delta > MAX_LEAN_DELTA_PER_FRAME) return prevSmoothedDeg + MAX_LEAN_DELTA_PER_FRAME;
  if (delta < -MAX_LEAN_DELTA_PER_FRAME) return prevSmoothedDeg - MAX_LEAN_DELTA_PER_FRAME;
  return rawDeg;
}
