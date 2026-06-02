// Warrior II reuses squat's helpers (LM indices, lmVisible, midpoint,
// trunkLeanDeg, kneeFlexionDeg). No new helpers needed — knee flex is the
// primary metric for both legs.
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
