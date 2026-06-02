// Star Pose reuses squat's landmark helpers + Tandem Stand's CoM proxy
// (identical to single-leg-stand — star pose is a single-leg balance hold).
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  dist,
  midpoint,
} from '@/modules/squat/geometry';

export { comProxy } from '@/modules/tandem-stand/geometry';
