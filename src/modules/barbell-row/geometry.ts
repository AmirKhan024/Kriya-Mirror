/**
 * Barbell Row geometry helpers — side-camera, bent-over position.
 *
 * Re-exports shared helpers from conventional-deadlift and bicep-curl geometry.
 * The barbell row uses:
 *   - hipHingeDeg: to check/track the bent-over working position
 *   - torsoAngleDeg: to detect back rounding during the row
 *   - elbowFlexionDeg: to track arm rowing motion (hanging → row peak)
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

// In side view, the camera-side shoulder-elbow-wrist triangle gives elbow flexion
// the same way as front view. Reuse bicep-curl's elbowFlexionDeg.
export { elbowFlexionDeg } from '@/modules/bicep-curl/geometry';
