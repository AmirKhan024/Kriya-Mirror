// Lunge reuses squat's front-view geometry directly. `kneeFlexionDeg` applied
// per-leg gives us the front-leg flex we track; `trunkLeanDeg` gives us trunk
// posture. No new helpers needed.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  kneeFlexionDeg,
  trunkLeanDeg,
} from '@/modules/squat/geometry';
