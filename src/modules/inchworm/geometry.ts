/**
 * Inchworm geometry helpers — re-exports from conventional-deadlift geometry.
 *
 * Primary metric: hipHingeDeg (from conventional-deadlift/geometry)
 *   0° = standing upright, ~80° = deep hip hinge
 *
 * kneeFlexionDeg is exported for optional use (unused in MVP engine, but
 * available for future tuck-depth detection during the plank phase).
 */
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  hipHingeDeg,
} from '@/modules/conventional-deadlift/geometry';

export { kneeFlexionDeg } from '@/modules/squat/geometry';
