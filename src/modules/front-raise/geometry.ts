// Front Raise reuses squat helpers + lateral-raise's shoulderAbductionDeg.
// The angle helper is plane-agnostic — same math reads as `abduction` in
// front view (lateral-raise) and `flexion` in side view (front-raise).
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

export { shoulderAbductionDeg } from '@/modules/lateral-raise/geometry';

/** Runtime floor on bodyHeight — chair-pose pattern. Side-view distance
 *  reference (NOT shoulderWidth, which collapses in side view). The engine
 *  doesn't use this as a divisor (angle math is geometric), but the
 *  calibration consumes it for the Fix-X cal-side rejection. */
export const MIN_BODY_HEIGHT_RUNTIME = 0.30;
