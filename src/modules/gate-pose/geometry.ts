// Gate Pose (front-on lateral side-bend) reuses squat's landmark helpers plus
// the oblique-side-bend lateral-lean primitives (frontal-plane torso tilt — the
// axis MediaPipe tracks most reliably).
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
  kneeFlexionDeg,
} from '@/modules/squat/geometry';

export {
  lateralLeanDeg,
  clampLeanDelta,
  MIN_SHOULDER_WIDTH_RUNTIME,
} from '@/modules/oblique-side-bend/geometry';
