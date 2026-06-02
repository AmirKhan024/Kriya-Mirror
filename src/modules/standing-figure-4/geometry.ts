// Standing Figure-4 reuses SLS's helpers (squat geometry + tandem-stand CoM
// proxy). Same single-leg balance geometry as Tree Pose — the figure-4 ankle
// crosses over the standing knee, detected via |liftedAnkle.x - standingKnee.x|.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  comProxy,
} from '@/modules/single-leg-stand/geometry';
