/**
 * Goddess Pose reuses squat's helpers (LM indices, lmVisible, midpoint,
 * trunkLeanDeg, kneeFlexionDeg) plus two goddess-specific checks:
 *   - kneeAnkleRatio: how aligned the knees are over the ankles (valgus)
 *   - elbowDropFromCactus: how far either elbow has fallen below the
 *     calibration-time cactus line (Y axis grows downward in MediaPipe coords)
 */
import type { NormalizedLandmark } from '@/modules/pose/types';

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

/** Knee-X separation divided by ankle-X separation.
 *  ~1.0 means knees track over the ankles; lower means knees are caving
 *  inward (valgus). Returns 1.0 if the ankles are basically together
 *  (degenerate denominator — caller should already have rejected this in
 *  calibration via the wide-stance gate). */
export function kneeAnkleRatio(
  lk: NormalizedLandmark,
  rk: NormalizedLandmark,
  la: NormalizedLandmark,
  ra: NormalizedLandmark,
): number {
  const kneeDx = Math.abs(lk.x - rk.x);
  const ankleDx = Math.abs(la.x - ra.x);
  if (ankleDx < 0.01) return 1.0;
  return kneeDx / ankleDx;
}

/** How far the higher of the two elbows has dropped below the baseline
 *  cactus line, normalized by shoulder width. The "higher" elbow (smaller Y
 *  in MediaPipe coords) is the one still holding cactus best; if EVEN that
 *  one has dropped, both arms have fallen. Returns 0 when arms are at-or-above
 *  baseline; positive when dropped. */
export function elbowDropFromCactus(
  le: NormalizedLandmark,
  re: NormalizedLandmark,
  baselineElbowYRelShoulder: number,
  currentShoulderY: number,
  shoulderWidthFloor: number,
): number {
  const baselineElbowY = currentShoulderY + baselineElbowYRelShoulder;
  // Lower Y = higher in image. Pick the higher elbow (lower Y value).
  const higherElbowY = Math.min(le.y, re.y);
  const drop = higherElbowY - baselineElbowY;
  if (drop <= 0) return 0;
  return drop / shoulderWidthFloor;
}
