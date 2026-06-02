// Tree Pose reuses SLS's helpers (which already re-export squat geometry +
// tandem-stand's CoM proxy). No new helpers needed — the foot-on-leg check
// is a simple |liftedAnkle.x - standingKnee.x| comparison done inline.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  comProxy,
} from '@/modules/single-leg-stand/geometry';
