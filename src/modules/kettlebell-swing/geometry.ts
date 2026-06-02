/**
 * Kettlebell Swing geometry helpers — side-camera, sagittal-plane view.
 *
 * Re-exports all shared helpers from conventional-deadlift (hip hinge, etc.)
 * and squat (knee flexion for squat-pattern detection).
 * Adds the arm-lift detection helper specific to KB swing.
 */

// Re-export ALL geometry from conventional-deadlift — all helpers are reusable
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  hipHingeDeg,
  torsoAngleDeg,
} from '@/modules/conventional-deadlift/geometry';

// Re-export knee flexion from squat for squat-pattern check
export { kneeFlexionDeg } from '@/modules/squat/geometry';

/**
 * Detects if wrist is actively being lifted above shoulder level (arm-lift error).
 * Returns true if wrist.y < shoulder.y - threshold (in normalised frame coords,
 * lower y = higher on screen).
 */
export function armLiftDetected(
  wristY: number,
  shoulderY: number,
  threshold: number,
): boolean {
  return (shoulderY - wristY) > threshold;
}
