/**
 * Tandem Stand scoring — adapted from BB5 spec §3.
 *
 * Per-tick form score = 100 − swayPenalty − trunkPenalty − tandemDriftPenalty.
 * Steadiness (60%) + form-adherence (40%) weighting handled in the final MQS
 * (computed by the play page from the rolling formScore series).
 */

export function getSwayPenalty(swayAngleDeg: number): number {
  // BB5 clinical bands: 0–3° normal, 4–8° moderate, 8°+ severe.
  // We map non-linearly so subtle sway is forgiven and severe sway dominates.
  if (swayAngleDeg <= 1) return 0;
  if (swayAngleDeg <= 3) return (swayAngleDeg - 1) * 4;     // 0..8
  if (swayAngleDeg <= 6) return 8 + (swayAngleDeg - 3) * 7; // 8..29
  if (swayAngleDeg <= 10) return 29 + (swayAngleDeg - 6) * 5; // 29..49
  return Math.min(60, 49 + (swayAngleDeg - 10) * 2);          // 49..60 (cap)
}

export function getTrunkPenalty(trunkLeanDeg: number): number {
  // BB5 calibration accepts trunk lean < 8°. During the hold we allow up to
  // 8° silently, then penalize linearly.
  const excess = Math.max(0, trunkLeanDeg - 8);
  return Math.min(20, excess * 1.5);
}

export function getTandemDriftPenalty(
  currentAnkleXDistance: number,
  baselineAnkleXDistance: number,
): number {
  // Feet drifting apart from tandem position — penalty grows with the spread.
  const drift = currentAnkleXDistance - baselineAnkleXDistance;
  return Math.min(20, Math.max(0, drift * 800));
}

export function computeFormScore(
  swayAngleDeg: number,
  trunkLeanDeg: number,
  currentAnkleXDistance: number,
  baselineAnkleXDistance: number,
): number {
  const swayPen = getSwayPenalty(swayAngleDeg);
  const trunkPen = getTrunkPenalty(trunkLeanDeg);
  const driftPen = getTandemDriftPenalty(currentAnkleXDistance, baselineAnkleXDistance);
  return Math.max(0, 100 - swayPen - trunkPen - driftPen);
}
