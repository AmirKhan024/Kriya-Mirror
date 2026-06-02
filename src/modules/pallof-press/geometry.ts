/**
 * Pallof Press geometry — pure functions, no side-effects.
 * Front camera. User stands facing the lens, arms extend forward (depth)
 * which in 2D projects to elbow angle widening as they press out.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible } from '@/modules/squat/geometry';
import type { PallofPressBaseline } from './types';

/**
 * Compute elbow extension angle (shoulder → elbow → wrist).
 * Average of left and right side for bilateral symmetry.
 * Returns degrees. 180° = fully extended, 90° = at chest.
 *
 * Angle at elbow vertex = atan2(cross, dot) between
 *   u = shoulder→elbow,  v = wrist→elbow  (both point away from elbow)
 */
export function computeElbowExtensionDeg(poses: PoseLandmarks): number {
  const ls = poses[LM.LEFT_SHOULDER];
  const le = poses[LM.LEFT_ELBOW];
  const lw = poses[LM.LEFT_WRIST];
  const rs = poses[LM.RIGHT_SHOULDER];
  const re = poses[LM.RIGHT_ELBOW];
  const rw = poses[LM.RIGHT_WRIST];

  const angles: number[] = [];

  if (lmVisible(ls) && lmVisible(le) && lmVisible(lw)) {
    angles.push(elbowAngleDeg(ls, le, lw));
  }
  if (lmVisible(rs) && lmVisible(re) && lmVisible(rw)) {
    angles.push(elbowAngleDeg(rs, re, rw));
  }

  if (angles.length === 0) return 90; // fallback: assume hands at chest
  return angles.reduce((s, v) => s + v, 0) / angles.length;
}

/** Angle at the elbow vertex (shoulder→elbow←wrist). 180° = straight arm. */
function elbowAngleDeg(
  shoulder: { x: number; y: number },
  elbow: { x: number; y: number },
  wrist: { x: number; y: number },
): number {
  // u = shoulder - elbow, v = wrist - elbow
  const ux = shoulder.x - elbow.x;
  const uy = shoulder.y - elbow.y;
  const vx = wrist.x - elbow.x;
  const vy = wrist.y - elbow.y;
  const dot = ux * vx + uy * vy;
  const cross = Math.abs(ux * vy - uy * vx);
  const angleAtElbow = Math.atan2(cross, dot) * (180 / Math.PI);
  return Math.max(0, Math.min(180, angleAtElbow));
}

/**
 * Compute torso rotation from calibrated baseline.
 * Measures left-vs-right shoulder Y asymmetry relative to calibrated level.
 *
 * If the user rotates their torso toward the band anchor, the near-side shoulder
 * drops (Y increases in image coords) and the far-side shoulder rises.
 * The signed rotation is (leftShoulderY - rightShoulderY) - (calibrated diff).
 *
 * We convert the Y-difference to an "angle" via atan2(yDiff, shoulderWidth)
 * as an approximation — keeps units in degrees.
 * Returns signed degrees; use |value| for threshold comparisons.
 */
export function computeTorsoRotationDeg(
  poses: PoseLandmarks,
  baseline: PallofPressBaseline,
): number {
  const ls = poses[LM.LEFT_SHOULDER];
  const rs = poses[LM.RIGHT_SHOULDER];
  if (!lmVisible(ls) || !lmVisible(rs)) return 0;

  const currentDiff = ls.y - rs.y; // positive = left shoulder lower (rotated toward right)
  const baselineDiff = baseline.leftShoulderY - baseline.rightShoulderY;
  const rotationDiff = currentDiff - baselineDiff;

  // Convert to approximate degrees using shoulder width as reference
  const shoulderWidth = Math.max(0.01, baseline.shoulderWidth);
  const rotDeg = Math.atan2(Math.abs(rotationDiff), shoulderWidth) * (180 / Math.PI);
  return rotationDiff >= 0 ? rotDeg : -rotDeg;
}

/**
 * Detect shoulder shrug: shoulders rising above calibrated baseline Y.
 * Returns true if shoulder mid-Y has risen > fraction of torsoHeight above baseline.
 *
 * In image coords: smaller Y = higher position.
 * shoulderMid.y < baseline.shoulderMid.y means shoulders have risen.
 */
export function detectShoulderShrug(
  poses: PoseLandmarks,
  baseline: PallofPressBaseline,
  threshold: number,
): boolean {
  const ls = poses[LM.LEFT_SHOULDER];
  const rs = poses[LM.RIGHT_SHOULDER];
  if (!lmVisible(ls) || !lmVisible(rs)) return false;

  const currentShoulderMidY = (ls.y + rs.y) / 2;
  const baselineShoulderMidY = (baseline.leftShoulderY + baseline.rightShoulderY) / 2;

  // Shrug = shoulders moved upward (lower Y value) relative to baseline
  const rise = baselineShoulderMidY - currentShoulderMidY;
  return rise > threshold * baseline.torsoHeight;
}
