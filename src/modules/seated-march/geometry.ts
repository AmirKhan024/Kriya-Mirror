// Seated March reuses squat helpers for landmark indices, visibility, midpoint.
// The per-side knee-elevation helpers below mirror high-knees: lift is computed
// against a per-side baseline knee Y, normalized by shoulder width with a Fix-X
// runtime floor on the divisor, plus a per-frame outlier clamp before EMA.
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
 * Per-side knee elevation as a percentage of shoulder width.
 *
 * Y is inverted in MediaPipe normalized coords (smaller Y = higher in frame),
 * so a rising knee has decreasing Y → positive lift. Baseline knee Y is captured
 * at cal-confirm when the user is seated at rest (both feet flat, thighs level).
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
 * Per-frame outlier clamp on raw knee Y, BEFORE EMA smoothing. Caps the
 * per-frame delta so a single mis-localized knee landmark can't spike the
 * smoothed signal. Seated march is slower than high-knees, so a tighter cap
 * than high-knees' 0.012 is fine.
 */
const MAX_KNEE_DELTA_PER_FRAME = 0.012;
export function clampKneeDelta(rawY: number, prevSmoothedY: number): number {
  const delta = rawY - prevSmoothedY;
  if (delta > MAX_KNEE_DELTA_PER_FRAME) return prevSmoothedY + MAX_KNEE_DELTA_PER_FRAME;
  if (delta < -MAX_KNEE_DELTA_PER_FRAME) return prevSmoothedY - MAX_KNEE_DELTA_PER_FRAME;
  return rawY;
}
