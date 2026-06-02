// Bicep Curl reuses squat's helpers (LM indices, lmVisible, midpoint,
// trunkLeanDeg) and pushup's elbowFlexionDeg helper (shoulder-elbow-wrist
// vector angle).
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
