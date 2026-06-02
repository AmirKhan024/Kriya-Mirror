// Shrug reuses squat's shared helpers.
// Front-camera, bilateral shoulder elevation is the primary signal.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
} from '@/modules/squat/geometry';

export { elbowFlexionDeg } from '@/modules/pushup/geometry';
