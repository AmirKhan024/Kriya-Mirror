// Warrior I reuses squat's helpers (LM indices, lmVisible, midpoint,
// trunkLeanDeg, kneeFlexionDeg). Knee flex is the primary lower-body metric for
// both Warriors; the only addition over Warrior II is an arms-overhead check,
// which is a direct wrist-vs-shoulder Y comparison done inline (no helper).
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  trunkLeanDeg,
  kneeFlexionDeg,
} from '@/modules/squat/geometry';
