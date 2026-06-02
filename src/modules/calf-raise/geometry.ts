// Calf Raise reuses squat's helpers for landmark indices, visibility, midpoint,
// trunk lean. The exercise-specific helpers below compute heel-rise from a
// flat-foot ankle-Y baseline and apply a per-frame outlier clamp (heel_rise_hold
// pattern) so single-frame MediaPipe glitches can't corrupt the EMA signal.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

// Runtime floor on shoulderWidth used as the heel-rise normalization divisor
// (Fix X). Matches `MIN_SHOULDER_WIDTH` at calibration time. Defense in depth
// against bad-baseline frames where shoulderWidth was accidentally captured
// near zero — without this floor every distance-normalized threshold collapses
// and the rep state machine fires on noise.
export const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

/**
 * Heel-rise expressed as a percentage of shoulder width.
 *
 * Y is inverted in MediaPipe normalized coords (smaller Y = higher in frame),
 * so when the heels lift, current avg ankle Y decreases and the delta below is
 * positive. A typical full heel-rise lands around 10-20 % at a normal stance.
 *
 *   baseline   – averaged left+right ankle Y captured at calibration (flat feet)
 *   currentY   – averaged left+right ankle Y this frame
 *   shoulderW  – baseline.shoulderWidth in normalized coords
 */
export function heelRisePctFromAnkles(
  currentY: number,
  baselineY: number,
  shoulderW: number,
): number {
  const w = Math.max(shoulderW, MIN_SHOULDER_WIDTH_RUNTIME);
  return ((baselineY - currentY) / w) * 100;
}

/**
 * Per-frame outlier clamp for raw ankle Y BEFORE EMA smoothing. Inspired by
 * heel_rise_hold's `MAX_ANKLE_DELTA_PER_FRAME = 0.008`: caps how far the raw
 * ankle Y can move from the previously-smoothed value in a single frame.
 * Single-frame MediaPipe glitches (occasional 5-10 % Y jumps even on stable
 * feet) are otherwise EMA-d in and corrupt the signal for ~10 frames.
 *
 *   rawY         – this frame's raw ankle Y (averaged L+R)
 *   prevSmoothedY – previous frame's EMA-smoothed ankle Y (or the seed value)
 *
 * Returns rawY clamped to [prevSmoothedY - MAX, prevSmoothedY + MAX].
 */
const MAX_ANKLE_DELTA_PER_FRAME = 0.008;
export function clampAnkleDelta(rawY: number, prevSmoothedY: number): number {
  const delta = rawY - prevSmoothedY;
  if (delta > MAX_ANKLE_DELTA_PER_FRAME) return prevSmoothedY + MAX_ANKLE_DELTA_PER_FRAME;
  if (delta < -MAX_ANKLE_DELTA_PER_FRAME) return prevSmoothedY - MAX_ANKLE_DELTA_PER_FRAME;
  return rawY;
}
