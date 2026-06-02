// Side Plank reuses squat's helpers (LM indices, lmVisible, midpoint). The
// body-line metric (hip deviation from the shoulder→ankle line + spine bend) is
// computed inline in the engine from those midpoints.
export {
  LM,
  VIS_THRESHOLD,
  lmVisible,
  allVisible,
  midpoint,
} from '@/modules/squat/geometry';
