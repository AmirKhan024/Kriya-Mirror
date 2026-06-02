// Re-export shared landmarks and visibility helper
export { LM, lmVisible } from '@/modules/squat/geometry';
// Re-export elbowFlexionDeg from bicep-curl (needed for calibration armsAtSides check)
export { elbowFlexionDeg } from '@/modules/bicep-curl/geometry';

import type { NormalizedLandmark } from '@/modules/pose/types';

/**
 * Compute the arm lift angle (degrees) of the shoulder→wrist vector from straight-down (0°).
 * 0° = arms hanging at sides.
 * 90° = arms fully horizontal (parallel to floor).
 * Uses the horizontal spread (dx) and vertical displacement (dy = wrist.y - shoulder.y).
 * Works regardless of whether the user is standing or bent over — pure angle geometry.
 */
export function armLiftDeg(shoulder: NormalizedLandmark, wrist: NormalizedLandmark): number {
  const dx = Math.abs(wrist.x - shoulder.x);  // horizontal spread
  const dy = wrist.y - shoulder.y;             // positive when wrist is BELOW shoulder (Y increases downward)
  return Math.max(0, Math.atan2(dx, dy) * (180 / Math.PI));
}
