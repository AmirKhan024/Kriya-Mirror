// Standing Side Leg Raise reuses squat helpers for landmark indices, visibility,
// midpoint, trunk lean. The exercise-specific helper computes per-side hip
// abduction angle (frontal plane) with a per-frame outlier clamp before EMA
// (mirrors high-knees' clampKneeDelta — the ankle landmark is MediaPipe's
// noisiest, so capping per-frame jumps suppresses spikes).
import type { NormalizedLandmark } from '@/modules/pose/types';

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

/** Runtime floor on shoulderWidth used as the distance/normalization divisor
 *  (Fix X). Matches `MIN_SHOULDER_WIDTH` at calibration time. */
export const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

/**
 * Hip abduction angle in degrees — how far the leg has swung OUT to the side in
 * the frontal (camera) plane. Computed as the angle of the hip→ankle vector
 * from straight-down vertical.
 *
 *   standing (ankle directly below hip) → ~0°
 *   leg lifted out to the side          → grows toward 90° (leg horizontal)
 *
 * Y is inverted in MediaPipe coords (down = +y), so when standing the ankle is
 * BELOW the hip (ankle.y > hip.y → dy > 0). As the leg abducts laterally, dx
 * grows. atan2(dx, dy) is the abduction angle. Frontal-plane only (x/y) — the
 * axis MediaPipe tracks most reliably.
 */
export function legAbductionDeg(
  hip: NormalizedLandmark,
  ankle: NormalizedLandmark,
): number {
  const dx = Math.abs(ankle.x - hip.x);
  const dy = ankle.y - hip.y; // positive when ankle below hip (normal standing)
  if (dy <= 0.0001) return 90; // leg horizontal or above the hip
  return Math.atan2(dx, dy) * (180 / Math.PI);
}

/**
 * Per-frame outlier clamp on the raw abduction angle, BEFORE EMA smoothing.
 * Mirrors high-knees' clampKneeDelta. A genuine fast leg raise moves ~2–3°/frame
 * at 30 fps; MediaPipe ankle spikes can be far larger. 6°/frame allows real
 * motion while killing single-frame jitter.
 */
const MAX_ABDUCTION_DELTA_PER_FRAME = 6;
export function clampAbductionDelta(rawDeg: number, prevSmoothedDeg: number): number {
  const delta = rawDeg - prevSmoothedDeg;
  if (delta > MAX_ABDUCTION_DELTA_PER_FRAME) return prevSmoothedDeg + MAX_ABDUCTION_DELTA_PER_FRAME;
  if (delta < -MAX_ABDUCTION_DELTA_PER_FRAME) return prevSmoothedDeg - MAX_ABDUCTION_DELTA_PER_FRAME;
  return rawDeg;
}
