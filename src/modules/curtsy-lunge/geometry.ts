/**
 * Curtsy Lunge geometry helpers — pure functions, no side effects.
 *
 * Front camera. User faces lens. The "active/front" leg is the standing leg
 * that bends. The "rear" leg is the one that steps diagonally behind (curtsy).
 *
 * Primary signal: front-leg knee flexion (hip → knee → ankle angle).
 * Secondary signal: rear ankle X crossing behind front ankle X (crossover ratio).
 */
import type { NormalizedLandmark } from '@/modules/pose/types';
import type { CurtsyLungeBaseline } from './types';

export { LM, lmVisible, midpoint } from '@/modules/squat/geometry';

/**
 * Compute the angle at the knee joint: hip → knee → ankle.
 * Returns degrees in [0, 180]. 180° = fully straight leg.
 *
 * Note: this is the JOINT angle (not flexion from straight). For curtsy lunge,
 * STANDING is ~170°, DEEP CURTSY is ~90–100°. Lower = more bent.
 */
export function computeKneeAngleDeg(
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
  ankle: NormalizedLandmark,
): number {
  const ux = hip.x - knee.x;
  const uy = hip.y - knee.y;
  const vx = ankle.x - knee.x;
  const vy = ankle.y - knee.y;
  const dot = ux * vx + uy * vy;
  const cross = Math.abs(ux * vy - uy * vx);
  const angleAtKnee = Math.atan2(cross, dot) * (180 / Math.PI);
  // Clamp to valid range
  return Math.max(0, Math.min(180, angleAtKnee));
}

/**
 * Determine which leg is the FRONT (standing/bending) leg.
 * The front leg has the LOWER angle (more bent). Lower angle = more flexed.
 * Returns 'left' if left knee angle is lower (more bent), else 'right'.
 */
export function detectActiveSide(
  leftKneeAngle: number,
  rightKneeAngle: number,
): 'left' | 'right' {
  return leftKneeAngle <= rightKneeAngle ? 'left' : 'right';
}

/**
 * Compute crossover ratio:
 * Positive = rear ankle has crossed behind front ankle (valid curtsy).
 * Negative or zero = rear ankle not crossed.
 * Normalized to hipWidth baseline for scale invariance.
 *
 * In front camera: for left-front-leg curtsy, the RIGHT ankle crosses
 * LEFTWARD (toward and past the left ankle).
 * For right-front-leg, the LEFT ankle crosses RIGHTWARD.
 */
export function computeCrossoverRatio(
  poses: NormalizedLandmark[],
  baseline: CurtsyLungeBaseline,
  activeSide: 'left' | 'right',
): number {
  const LM_LEFT_ANKLE = 27;
  const LM_RIGHT_ANKLE = 28;

  const leftAnkle = poses[LM_LEFT_ANKLE];
  const rightAnkle = poses[LM_RIGHT_ANKLE];

  if (!leftAnkle || !rightAnkle) return 0;
  if (baseline.hipWidth <= 0) return 0;

  // frontAnkle = the standing (active) leg ankle
  // rearAnkle = the crossing (curtsy) leg ankle
  const frontAnkle = activeSide === 'left' ? leftAnkle : rightAnkle;
  const rearAnkle = activeSide === 'left' ? rightAnkle : leftAnkle;

  // For a left-front-leg curtsy: rear (right) ankle should move LEFT past front (left) ankle.
  // In image coords, x increases right. Left = smaller x.
  // Crossover = frontAnkle.x - rearAnkle.x (positive when rear has passed front to the left).
  // For a right-front-leg curtsy: rear (left) ankle should move RIGHT past front (right) ankle.
  // Crossover = rearAnkle.x - frontAnkle.x.
  let crossoverPx: number;
  if (activeSide === 'left') {
    // rear (right) ankle crosses leftward: positive when rearAnkle.x < frontAnkle.x
    crossoverPx = frontAnkle.x - rearAnkle.x;
  } else {
    // rear (left) ankle crosses rightward: positive when rearAnkle.x > frontAnkle.x
    crossoverPx = rearAnkle.x - frontAnkle.x;
  }

  return crossoverPx / baseline.hipWidth;
}

/**
 * Compute torso lean angle from vertical (degrees).
 * Uses shoulder-midpoint and hip-midpoint landmarks.
 * 0° = perfectly upright, 90° = horizontal.
 */
export function computeTrunkLeanDeg(poses: NormalizedLandmark[]): number {
  const LM_LEFT_SHOULDER = 11;
  const LM_RIGHT_SHOULDER = 12;
  const LM_LEFT_HIP = 23;
  const LM_RIGHT_HIP = 24;

  const ls = poses[LM_LEFT_SHOULDER];
  const rs = poses[LM_RIGHT_SHOULDER];
  const lh = poses[LM_LEFT_HIP];
  const rh = poses[LM_RIGHT_HIP];

  if (!ls || !rs || !lh || !rh) return 0;

  const shoulderMidX = (ls.x + rs.x) / 2;
  const shoulderMidY = (ls.y + rs.y) / 2;
  const hipMidX = (lh.x + rh.x) / 2;
  const hipMidY = (lh.y + rh.y) / 2;

  const dx = shoulderMidX - hipMidX;
  const dy = hipMidY - shoulderMidY; // positive when shoulders above hips (normal)
  if (dy <= 0.0001) return 90;
  return Math.atan2(Math.abs(dx), dy) * (180 / Math.PI);
}

/**
 * Detect hip rotation: rear hip rising above calibrated Y baseline.
 * Returns true if rear hip Y has risen > threshold fraction of torsoHeight.
 *
 * In image Y coords: smaller Y = higher in frame.
 * "Rising" means the rear hip Y is meaningfully smaller than baseline hipMid.y.
 */
export function detectHipRotation(
  poses: NormalizedLandmark[],
  baseline: CurtsyLungeBaseline,
  activeSide: 'left' | 'right',
  threshold: number,
): boolean {
  const LM_LEFT_HIP = 23;
  const LM_RIGHT_HIP = 24;

  const leftHip = poses[LM_LEFT_HIP];
  const rightHip = poses[LM_RIGHT_HIP];

  if (!leftHip || !rightHip) return false;
  if (baseline.torsoHeight <= 0) return false;

  // rearHip = the hip of the crossing (curtsy) leg
  const rearHip = activeSide === 'left' ? rightHip : leftHip;

  // baseline.hipMid.y is the Y of the mid-hip at calibration.
  // If rear hip rises (Y decreases), it indicates hip rotation/hiking.
  const rise = baseline.hipMid.y - rearHip.y; // positive = rearHip has risen above baseline
  return rise > threshold * baseline.torsoHeight;
}
