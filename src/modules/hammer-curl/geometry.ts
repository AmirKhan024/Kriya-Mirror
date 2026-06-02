// Hammer Curl reuses squat's shared helpers and pushup's elbowFlexionDeg.
// The neutral-grip geometry is identical to supinated grip from a 2D front-camera
// perspective — elbow flexion is still shoulder-elbow-wrist angle.
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
