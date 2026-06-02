/**
 * Romanian Deadlift geometry helpers — side-camera, sagittal-plane view.
 *
 * Re-exports all geometry from conventional-deadlift (hipHingeDeg, torsoAngleDeg)
 * and kneeFlexionDeg from squat (hip-knee-ankle angle for knee stability check).
 */

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

export { kneeFlexionDeg } from '@/modules/squat/geometry';
