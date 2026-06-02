// Cat-Cow (side-on quadruped) reuses squat's landmark helpers. The exercise-
// specific signal is the HEAD/NECK pitch — the only large, side-on-reliable
// proxy for spinal flexion-extension, since BlazePose has no mid-spine landmarks.
import type { NormalizedLandmark } from '@/modules/pose/types';

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
} from '@/modules/squat/geometry';

/** Runtime floor analog: the side-on body span used for the distance gate (the
 *  pure-angle runtime metric has no distance normalizer to collapse). */
export const MIN_BODY_SPAN_RUNTIME = 0.20;

/**
 * Head/neck pitch in degrees — how far the head is lifted (cow/extension) vs
 * tucked (cat/flexion), measured as the angle of the shoulder→nose vector from
 * horizontal in the sagittal (side-camera) plane.
 *
 *   nose ABOVE the shoulder (chin up, gaze forward/up) → positive  (COW / extension)
 *   nose level with the shoulder                       → ~0        (neutral)
 *   nose BELOW the shoulder (chin to chest)            → negative  (CAT / flexion)
 *
 * Y is inverted in MediaPipe coords (down = +y). dy = shoulder.y − nose.y is
 * positive when the nose sits higher in the frame than the shoulder.
 */
export function neckPitchDeg(
  nose: NormalizedLandmark,
  shoulder: NormalizedLandmark,
): number {
  const dx = Math.abs(nose.x - shoulder.x);
  const dy = shoulder.y - nose.y; // positive when nose is ABOVE the shoulder (cow)
  if (dx < 1e-4) return dy >= 0 ? 90 : -90;
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

/**
 * Per-frame outlier clamp on the raw neck pitch, BEFORE EMA smoothing (mirrors
 * side-leg-raise's clampAbductionDelta). The head moves fast in a brisk cat-cow,
 * so allow a generous 8°/frame while still killing single-frame nose spikes.
 */
const MAX_PITCH_DELTA_PER_FRAME = 8;
export function clampPitchDelta(rawDeg: number, prevSmoothedDeg: number): number {
  const delta = rawDeg - prevSmoothedDeg;
  if (delta > MAX_PITCH_DELTA_PER_FRAME) return prevSmoothedDeg + MAX_PITCH_DELTA_PER_FRAME;
  if (delta < -MAX_PITCH_DELTA_PER_FRAME) return prevSmoothedDeg - MAX_PITCH_DELTA_PER_FRAME;
  return rawDeg;
}
