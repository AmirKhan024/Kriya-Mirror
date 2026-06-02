// Overhead Press geometry helpers — re-exports shared utilities and
// adds OHP-specific helpers for back arch and bar path drift.

export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
} from '@/modules/squat/geometry';

// Re-use bicep-curl's elbowFlexionDeg (shoulder-elbow-wrist angle).
// For OHP: elbowFlexionDeg returns the interior bend angle at elbow.
//   Racked (arms bent ~70–90°): elbowFlexionDeg returns ~70–90°
//   Locked out (arms extended overhead ~170°): returns ~10–15°
// We call this value "extension" for OHP — lower = more extended.
export { elbowFlexionDeg } from '@/modules/bicep-curl/geometry';

/**
 * backArchOffset — measures horizontal offset between hip midpoint and shoulder
 * midpoint. A large positive delta (hips forward of shoulders) indicates
 * lower-back hyperextension during overhead press.
 *
 * Returns a positive number when hips are forward of shoulders in X.
 * Threshold ~0.06 triggers the warning.
 */
export function backArchOffset(
  hipMid: { x: number; y: number },
  shoulderMid: { x: number; y: number },
): number {
  // In front-facing camera: lower back arch pushes hips forward (+x from user's
  // perspective maps to +x in mirrored image). We measure absolute deviation.
  return Math.abs(hipMid.x - shoulderMid.x);
}

/**
 * wristPathDrift — measures horizontal (X) displacement of current wrist
 * midpoint vs the baseline wrist X captured at calibration.
 * Values > BAR_PATH_DRIFT_THRESHOLD (~0.04) indicate the bar is drifting
 * forward/backward instead of traveling in a straight vertical line.
 */
export function wristPathDrift(
  currentWristMidX: number,
  baselineWristMidX: number,
): number {
  return Math.abs(currentWristMidX - baselineWristMidX);
}
