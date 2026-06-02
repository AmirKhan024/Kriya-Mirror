import type { PoseLandmarks } from '@/modules/pose/types';
import type { LateralBandWalkBaseline, StepDirection } from './types';

export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export const VIS_THRESHOLD = 0.4;

export function lmVisible(lm: { visibility?: number } | undefined): boolean {
  return !!lm && (lm.visibility ?? 0) >= VIS_THRESHOLD;
}

export function midpoint<T extends { x: number; y: number }>(a: T, b: T): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Compute lateral hip displacement relative to calibrated midpoint.
 * Returns positive for rightward movement, negative for leftward.
 * Normalized to shoulder width (so 0.05 = 5% of shoulder width).
 */
export function computeLateralHipDisplacement(
  poses: PoseLandmarks,
  baseline: LateralBandWalkBaseline,
): number {
  const lh = poses[LM.LEFT_HIP];
  const rh = poses[LM.RIGHT_HIP];
  if (!lh || !rh) return 0;

  const currentHipX = (lh.x + rh.x) / 2;
  const displacement = currentHipX - baseline.hipMid.x;

  // Normalize by shoulder width for body-size independence
  const norm = baseline.shoulderWidth > 0 ? displacement / baseline.shoulderWidth : displacement;
  return norm;
}

/**
 * Determine step direction from consecutive frames.
 * Compare current hipMid.x to previous hipMid.x.
 */
export function detectStepDirection(
  currentHipX: number,
  previousHipX: number,
): StepDirection {
  const delta = currentHipX - previousHipX;
  if (Math.abs(delta) < 0.001) return null;
  // In MediaPipe, X increases left→right (from the camera's perspective).
  // User stepping right → hipMid.x increases (moves toward higher x).
  // User stepping left → hipMid.x decreases (moves toward lower x).
  return delta > 0 ? 'right' : 'left';
}

/**
 * Compute lateral trunk lean angle from vertical (degrees).
 * Measures how much the shoulder midpoint is displaced laterally vs the hip midpoint.
 * 0° = perfectly upright, 30°+ = excessive lateral lean.
 */
export function computeLateralTrunkLeanDeg(
  poses: PoseLandmarks,
): number {
  const ls = poses[LM.LEFT_SHOULDER];
  const rs = poses[LM.RIGHT_SHOULDER];
  const lh = poses[LM.LEFT_HIP];
  const rh = poses[LM.RIGHT_HIP];

  if (!ls || !rs || !lh || !rh) return 0;

  const shoulderMidX = (ls.x + rs.x) / 2;
  const hipMidX = (lh.x + rh.x) / 2;
  const shoulderMidY = (ls.y + rs.y) / 2;
  const hipMidY = (lh.y + rh.y) / 2;

  const dx = shoulderMidX - hipMidX;
  const dy = Math.abs(hipMidY - shoulderMidY); // vertical trunk length (positive)

  if (dy <= 0.0001) return 90;
  return Math.atan2(Math.abs(dx), dy) * (180 / Math.PI);
}

/**
 * Detect hip drop: the hip on the stepping side drops below calibrated level.
 * Returns true if stepping-side hip Y drops > threshold fraction of torsoHeight.
 * In MediaPipe, Y increases downward, so a higher Y means a lower hip.
 */
export function detectHipDrop(
  poses: PoseLandmarks,
  baseline: LateralBandWalkBaseline,
  stepDirection: StepDirection,
  threshold: number,
): boolean {
  if (stepDirection === null) return false;

  const lh = poses[LM.LEFT_HIP];
  const rh = poses[LM.RIGHT_HIP];
  if (!lh || !rh) return false;

  // The "stepping side" hip is the one the user is stepping toward.
  // If stepping right, the right hip dips; if stepping left, the left hip dips.
  const steppingHipY = stepDirection === 'right' ? rh.y : lh.y;
  const baselineHipY = stepDirection === 'right' ? baseline.rightHipY : baseline.leftHipY;

  const drop = steppingHipY - baselineHipY; // positive = hip dropped (lower in frame)
  const normalized = baseline.torsoHeight > 0 ? drop / baseline.torsoHeight : 0;
  return normalized > threshold;
}

/**
 * Check if the user is approaching the frame edge.
 * Returns true if hipMid.x < leftEdge OR > rightEdge.
 */
export function isNearFrameEdge(
  hipMidX: number,
  leftEdgeThreshold: number,
  rightEdgeThreshold: number,
): boolean {
  return hipMidX < leftEdgeThreshold || hipMidX > rightEdgeThreshold;
}

// BUG-LBW-11: Walking gate threshold.
// Normal walking swing phase lifts ankle 5–20cm → 3–12% frame height asymmetry.
// Lateral band walk shuffle lifts ankle 0–2cm → 0–1% frame height asymmetry.
// 4% threshold cleanly separates these without false-rejecting shuffle steps.
export const ANKLE_Y_ASYM_THRESHOLD = 0.04;

/**
 * Detect forward walking by measuring ankle Y asymmetry.
 *
 * During normal walking, one foot is in swing phase (lifted 5–20cm off floor),
 * creating significant Y asymmetry between the two ankle landmarks.
 * During a lateral band walk shuffle, BOTH feet remain on or near the floor —
 * the band physically prevents lifting either foot more than ~2cm.
 *
 * In MediaPipe, Y increases downward. A raised ankle has a LOWER Y value
 * (closer to top of frame). The support ankle has a HIGHER Y value (near floor).
 *
 * Returns true if walking is detected (one foot clearly raised), false if
 * both feet appear to be on the floor (lateral shuffle or standing still).
 */
export function detectForwardWalking(poses: PoseLandmarks): boolean {
  const la = poses[LM.LEFT_ANKLE];
  const ra = poses[LM.RIGHT_ANKLE];
  if (!la || !ra) return false;
  // Support ankle Y ≈ 0.85, swing ankle Y ≈ 0.70–0.78 → difference ≈ 0.07–0.15 (walking)
  // Both ankles Y ≈ 0.84–0.87 → difference ≈ 0.00–0.02 (lateral shuffle)
  return Math.abs(la.y - ra.y) > ANKLE_Y_ASYM_THRESHOLD;
}
