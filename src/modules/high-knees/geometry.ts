// High Knees reuses squat helpers for landmark indices, visibility, midpoint.
// The exercise-specific helpers below compute per-side knee elevation from
// a per-side baseline knee Y, with a Fix-X runtime floor on the shoulder-width
// divisor and a per-frame outlier clamp before EMA (heel_rise_hold pattern).
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

/** Runtime floor on shoulderWidth used as the lift-normalization divisor
 *  (Fix X). Matches `MIN_SHOULDER_WIDTH` at calibration time. */
export const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

/**
 * Per-side knee elevation expressed as a percentage of shoulder width.
 *
 * Y is inverted in MediaPipe normalized coords (smaller Y = higher in frame),
 * so a rising knee has decreasing Y → positive lift. Baseline knee Y is the
 * value captured at cal-confirm when both knees are flat-foot resting.
 *
 *   currentKneeY  — this frame's knee landmark Y
 *   baselineKneeY — captured at cal-confirm
 *   shoulderW     — baseline.shoulderWidth in normalized coords
 */
export function kneeLiftPctFromKnee(
  currentKneeY: number,
  baselineKneeY: number,
  shoulderW: number,
): number {
  const w = Math.max(shoulderW, MIN_SHOULDER_WIDTH_RUNTIME);
  return ((baselineKneeY - currentKneeY) / w) * 100;
}

/**
 * Per-frame outlier clamp on raw knee Y, BEFORE EMA smoothing. Inspired by
 * heel_rise_hold's per-frame delta cap. The threshold (0.012) is wider than
 * calf-raise's 0.008 because knee motion has a larger natural per-frame delta
 * during fast cadence (the knee can legitimately move ~1% Y per 30 fps frame
 * during an explosive high-knee).
 */
const MAX_KNEE_DELTA_PER_FRAME = 0.012;
export function clampKneeDelta(rawY: number, prevSmoothedY: number): number {
  const delta = rawY - prevSmoothedY;
  if (delta > MAX_KNEE_DELTA_PER_FRAME) return prevSmoothedY + MAX_KNEE_DELTA_PER_FRAME;
  if (delta < -MAX_KNEE_DELTA_PER_FRAME) return prevSmoothedY - MAX_KNEE_DELTA_PER_FRAME;
  return rawY;
}
