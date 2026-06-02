/**
 * Synthesizes MediaPipe-shaped 33-element landmark arrays from clinical intent.
 * Mirrors the pattern from
 * kriya-activities/mobility_new/spinal_wave/test/harness/pose-stub.mjs
 *
 * Coordinates are in normalized image space (0..1). x increases right, y down.
 *
 * Key geometric insight for SQUAT (front-view):
 *   The engine's kneeFlexionDeg is the 2D angle at knee in triangle hip-knee-ankle.
 *   For the angle to be non-degenerate, knee MUST be horizontally offset from the
 *   hip-ankle line. We model this with a "swing-out" model: as flexion grows,
 *   knee swings outward (away from body midline) by half-flexion, and hip swings
 *   further outward by another half-flexion. Result: a perfect symmetric squat.
 */
import type { NormalizedLandmark, PoseLandmarks } from '@/modules/pose/types';
import { IDX, LM_COUNT, type SquatPoseIntent, type PlankPoseIntent, type PushupPoseIntent, type LungePoseIntent, type LateralLungePoseIntent, type TandemStandPoseIntent, type BicepCurlPoseIntent, type SingleLegStandPoseIntent, type StarPosePoseIntent, type ChairPosePoseIntent, type LateralRaisePoseIntent, type TreePosePoseIntent, type StandingFigure4PoseIntent, type GatePosePoseIntent, type CossackSquatPoseIntent, type CatCowPoseIntent, type WarriorTwoPoseIntent, type WarriorOnePoseIntent, type Warrior3PoseIntent, type SidePlankPoseIntent, type BoatPosePoseIntent, type MountainPosePoseIntent, type CalfRaisePoseIntent, type JumpingJacksPoseIntent, type HighKneesPoseIntent, type FrontRaisePoseIntent, type ArmCirclesPoseIntent, type GoddessPosePoseIntent, type TrianglePosePoseIntent, type WallSitPoseIntent, type SideLegRaisePoseIntent, type ObliqueSideBendPoseIntent, type ForwardFoldPoseIntent, type DownwardDogPoseIntent, type CobraPosePoseIntent, type SeatedMarchPoseIntent, type SeatedForwardFoldPoseIntent } from './types';

// ─── Deterministic PRNG (mulberry32) ───
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number, sigma: number): number {
  if (sigma === 0) return 0;
  const u1 = Math.max(rnd(), 1e-9);
  const u2 = rnd();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function makeLandmark(x: number, y: number, visibility = 0.95): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}

function emptyPose(): PoseLandmarks {
  const out: PoseLandmarks = new Array(LM_COUNT);
  for (let i = 0; i < LM_COUNT; i++) out[i] = makeLandmark(0.5, 0.5, 0);
  return out;
}

function applyNoise(pose: PoseLandmarks, sigma: number, seed: number): void {
  if (sigma === 0) return;
  const rnd = mulberry32(seed);
  for (const lm of pose) {
    lm.x += gauss(rnd, sigma);
    lm.y += gauss(rnd, sigma);
  }
}

function applyOcclusion(pose: PoseLandmarks, indices: number[] | undefined): void {
  if (!indices) return;
  for (const i of indices) {
    if (pose[i]) pose[i].visibility = 0;
  }
}

// ────────────────────────────────────────────────────────────────────────
// SQUAT — front-facing, symmetric swing-out geometry
// ────────────────────────────────────────────────────────────────────────
//
// Per leg, given target kneeFlexionDeg θ:
//   ankle stays planted
//   lower leg points UP-AND-OUTWARD by half-angle (LL × {sin(θ/2), cos(θ/2)})
//   upper leg from knee continues UP-AND-OUTWARD by another half-angle (UL × ...)
// At θ=0 (standing): knee directly above ankle, hip directly above knee. Angle at knee = 180° → flexion = 0°.
// At θ=90: knee offset outward, hip further outward at same height as knee. Angle at knee = 90° → flexion = 90°.
// At θ=130 (deep ATG): knee far outward, hip further outward and slightly BELOW knee. Angle at knee = 50° → flexion = 130°.
//
// The hip-pair will be spread further apart at deep flexion than at standing — that's
// physically over-spread (real pelvis is rigid) but it doesn't matter for the engine
// which reads each leg independently.

const L = 0.22; // upper-leg = lower-leg length in 2D (isoceles triangle assumption)

/**
 * For target kneeFlexionDeg θ, builds an isoceles hip-knee-ankle triangle:
 *   - Hip directly above ankle (vertical base)
 *   - Hip-ankle distance shrinks as θ grows: |H - A| = 2L·cos(θ/2)
 *   - Knee sits on the perpendicular bisector of (H, A) at offset L·sin(θ/2)
 *     — outward (away from body midline) per the `sign` argument.
 *
 * This guarantees the engine's atan2-based kneeFlexionDeg(H, K, A) returns θ.
 */
function legGeometry(ankleX: number, ankleY: number, flexDeg: number, sign: -1 | 1) {
  const halfRad = (flexDeg / 2) * Math.PI / 180;
  const baseLen = 2 * L * Math.cos(halfRad);   // hip-to-ankle distance
  const offset = L * Math.sin(halfRad);        // knee perpendicular offset from base midpoint

  const hipX = ankleX;                          // hip directly above ankle (vertical base)
  const hipY = ankleY - baseLen;
  const midY = ankleY - baseLen / 2;
  const kneeX = ankleX + sign * offset;         // knee outward perpendicular
  const kneeY = midY;
  return { kneeX, kneeY, hipX, hipY };
}

export function buildSquatPose(intent: SquatPoseIntent): PoseLandmarks {
  const {
    kneeFlexionDeg,
    feetWidthRatio = 1.25,
    armsOverhead = true,
    heelLift = 0,
    valgusRatio = 0,
    trunkLeanDeg = 0,
    leftKneeFlexionDeg,
    rightKneeFlexionDeg,
    bodyHeight = 0.70, // not strictly used by squat engine but affects distance-gate
    facingRatio = 1.0,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const ankleY = baseAnkleY - heelLift;

  // Shoulder width (drives facing detection)
  const shoulderWidth = 0.16 * facingRatio;
  const shoulderHalf = shoulderWidth / 2;

  // Ankle x positions — feetWidthRatio × shoulder width / 2
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;

  // Build each leg independently
  const flexLeft = leftKneeFlexionDeg ?? kneeFlexionDeg;
  const flexRight = rightKneeFlexionDeg ?? kneeFlexionDeg;
  const left = legGeometry(ankleXLeft, ankleY, flexLeft, -1);
  const right = legGeometry(ankleXRight, ankleY, flexRight, +1);

  // 2026-05-25 (collapsed-knees regression): valgusRatio now interpolates the
  // knee positions toward the body midline (cx = 0.5). At valgusRatio=0 knees
  // stay where the swing-out geometry put them; at valgusRatio=1 knees are
  // fully collapsed and touching at the midline. Linear interpolation between
  // the two. With this scaling, valgusRatio >= ~0.6 reliably triggers the
  // engine's valgus detector (which compares current kneeWidth vs baseline).
  // The previous additive `valgusRatio * 0.06` could never overcome the natural
  // swing-out at deep flexion, which is why the original 03-posture-warnings
  // valgus test was `it.skip`ped.
  const adjLeftKneeX = left.kneeX * (1 - valgusRatio) + cx * valgusRatio;
  const adjRightKneeX = right.kneeX * (1 - valgusRatio) + cx * valgusRatio;

  // Shoulders at hip midpoint horizontally, lifted by torsoHeight
  const hipMidX = (left.hipX + right.hipX) / 2;
  const hipMidY = (left.hipY + right.hipY) / 2;
  const torsoHeight = 0.18;

  // Trunk lean: physical model. At lean=0, shoulder is directly above hip
  // (height = torsoHeight). At lean=90°, shoulder is at hip height, fully
  // forward by torsoHeight. The 2D x-displacement matters because the engine's
  // trunkLeanDeg = atan2(|dx|, dy) where dx = shoulderMid.x - hipMid.x.
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderY = hipMidY - torsoHeight * Math.cos(leanRad);
  const shoulderXShift = Math.sin(leanRad) * torsoHeight;

  const headY = shoulderY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(hipMidX + shoulderXShift, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(hipMidX - 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(hipMidX + 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(hipMidX - 0.035 + shoulderXShift, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(hipMidX + 0.035 + shoulderXShift, headY, visibility);

  // Shoulders
  pose[IDX.leftShoulder] = makeLandmark(hipMidX - shoulderHalf + shoulderXShift, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(hipMidX + shoulderHalf + shoulderXShift, shoulderY, visibility);

  // Arms
  if (armsOverhead) {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY - 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY - 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY - 0.20, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY - 0.20, visibility);
  } else {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.18, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.18, visibility);
  }

  // Hips
  pose[IDX.leftHip] = makeLandmark(left.hipX, left.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(right.hipX, right.hipY, visibility);

  // Knees (with valgus adjustment)
  pose[IDX.leftKnee] = makeLandmark(adjLeftKneeX, left.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(adjRightKneeX, right.kneeY, visibility);

  // Ankles
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);

  // Heels + toes (rough)
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  // Override bodyHeight via distance-relevant landmark spread
  // (Engine computes bodyHeight as abs(ankle.y - shoulder.y).) Already handled by torsoHeight + leg geometry.
  // For a target bodyHeight, the test scenarios just pick reasonable defaults.
  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// SINGLE LEG STAND — front-facing standing pose, one foot lifted.
// ────────────────────────────────────────────────────────────────────────
//
// Both feet roughly under hips at calibration baseline, but the lifted-side
// ankle has a smaller y (higher in frame). The lifted-side hip can drop on
// the y-axis to simulate Trendelenburg sign (hip-tilted warning).

export function buildSingleLegStandPose(intent: SingleLegStandPoseIntent = {}): PoseLandmarks {
  const {
    liftedSide = 'left',
    liftElevation = 0.10,
    hipDrop = 0,
    swayX = 0,
    swayY = 0,
    shoulderRise = 0,
    armsRaised = false,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    kneeLiftOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Standing skeleton (similar to bicep-curl pose stub)
  const cx = 0.50 + swayX;
  const baseAnkleY = 0.92;
  // 2026-05-25 round 13: allow overriding for the cal-reject regression test.
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = 0.06;

  // Vertical chain (upper body sways with swayX/swayY)
  const hipMidY = baseAnkleY - 0.40 + swayY;
  const shoulderMidY = hipMidY - 0.18 - shoulderRise;
  const headY = shoulderMidY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(cx, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(cx - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(cx + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(cx - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(cx + 0.035, headY, visibility);

  // Shoulders
  pose[IDX.leftShoulder] = makeLandmark(cx - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf, shoulderMidY, visibility);

  // Hips — lifted-side hip drops by `hipDrop` (positive = drops = larger y)
  const leftHipY = liftedSide === 'left' ? hipMidY + hipDrop : hipMidY;
  const rightHipY = liftedSide === 'right' ? hipMidY + hipDrop : hipMidY;
  pose[IDX.leftHip] = makeLandmark(cx - hipHalf, leftHipY, visibility);
  pose[IDX.rightHip] = makeLandmark(cx + hipHalf, rightHipY, visibility);

  // Wrists — relaxed at sides (below shoulders) by default; raised if intent says so
  const wristY = armsRaised ? shoulderMidY - 0.10 : hipMidY + 0.04;
  pose[IDX.leftElbow] = makeLandmark(cx - hipHalf - 0.02, (shoulderMidY + hipMidY) / 2, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + hipHalf + 0.02, (shoulderMidY + hipMidY) / 2, visibility);
  pose[IDX.leftWrist] = makeLandmark(cx - hipHalf - 0.01, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(cx + hipHalf + 0.01, wristY, visibility);

  // Ankles — standing-side at floor; lifted-side elevated
  // (feet x positions don't depend on swayX — feet are planted)
  const ankleXLeft = (cx - swayX) - 0.06;
  const ankleXRight = (cx - swayX) + 0.06;
  const standingAnkleY = baseAnkleY;
  const liftedAnkleY = baseAnkleY - liftElevation;
  const leftAnkleY = liftedSide === 'left' ? liftedAnkleY : standingAnkleY;
  const rightAnkleY = liftedSide === 'right' ? liftedAnkleY : standingAnkleY;

  // Knees — standing leg roughly straight; lifted leg has knee slightly bent (between hip + lifted ankle)
  // 2026-05-25 round 14: kneeLiftOverride (if set) decouples lifted-side knee
  // Y from the ankle, so tests can simulate the "ankle moves but knee doesn't
  // bend" case (MediaPipe false-positive on the cal lift gate).
  const leftKneeY = kneeLiftOverride !== undefined && liftedSide === 'left'
    ? (leftHipY + (baseAnkleY - kneeLiftOverride * 2)) / 2
    : (leftHipY + leftAnkleY) / 2;
  const rightKneeY = kneeLiftOverride !== undefined && liftedSide === 'right'
    ? (rightHipY + (baseAnkleY - kneeLiftOverride * 2)) / 2
    : (rightHipY + rightAnkleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, leftKneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, rightKneeY, visibility);

  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, leftAnkleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, rightAnkleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, leftAnkleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, rightAnkleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, leftAnkleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, rightAnkleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// STAR POSE — single-leg balance. Stand on one leg; the OTHER leg is extended
// out to the side (lifted + laterally spread); both arms raised into a star.
// Sway = drift of the whole upper body (CoM); the feet stay planted.
// ────────────────────────────────────────────────────────────────────────

export function buildStarPosePose(intent: StarPosePoseIntent = {}): PoseLandmarks {
  const {
    liftedSide = 'left',
    liftElevation = 0.10,
    legSpread = 0.28,
    armsUp = true,
    swayX = 0,
    swayY = 0,
    shoulderRise = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + swayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = 0.06;

  // Vertical chain (upper body sways with swayX/swayY).
  const hipMidY = baseAnkleY - 0.40 + swayY;
  const shoulderMidY = hipMidY - 0.18 - shoulderRise;
  const headY = shoulderMidY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(cx, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(cx - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(cx + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(cx - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(cx + 0.035, headY, visibility);

  // Shoulders
  pose[IDX.leftShoulder] = makeLandmark(cx - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf, shoulderMidY, visibility);

  // Hips
  pose[IDX.leftHip] = makeLandmark(cx - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(cx + hipHalf, hipMidY, visibility);

  // Arms — raised above the shoulders + spread wide for the star; OR down at
  // the sides when armsUp is false.
  const wristY = armsUp ? shoulderMidY - 0.12 : hipMidY + 0.04;
  const wristXOffset = armsUp ? shoulderHalf + 0.10 : hipHalf + 0.01;
  const elbowY = armsUp ? shoulderMidY - 0.04 : (shoulderMidY + hipMidY) / 2;
  pose[IDX.leftElbow] = makeLandmark(cx - shoulderHalf - 0.04, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + shoulderHalf + 0.04, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(cx - wristXOffset, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(cx + wristXOffset, wristY, visibility);

  // Ankles — standing leg planted under body (slightly toward the standing
  // side); extended leg out to the side + lifted. Feet don't move with swayX.
  const fx = cx - swayX;
  const standingAnkleX = liftedSide === 'left' ? fx + 0.04 : fx - 0.04;
  const extendedAnkleX = liftedSide === 'left' ? fx - legSpread : fx + legSpread;
  const standingAnkleY = baseAnkleY;
  const extendedAnkleY = baseAnkleY - liftElevation;

  const leftAnkleX = liftedSide === 'left' ? extendedAnkleX : standingAnkleX;
  const rightAnkleX = liftedSide === 'right' ? extendedAnkleX : standingAnkleX;
  const leftAnkleY = liftedSide === 'left' ? extendedAnkleY : standingAnkleY;
  const rightAnkleY = liftedSide === 'right' ? extendedAnkleY : standingAnkleY;

  // Knees — midway hip→ankle on each side.
  const leftKneeY = (hipMidY + leftAnkleY) / 2;
  const rightKneeY = (hipMidY + rightAnkleY) / 2;
  pose[IDX.leftKnee] = makeLandmark((cx - hipHalf + leftAnkleX) / 2, leftKneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark((cx + hipHalf + rightAnkleX) / 2, rightKneeY, visibility);

  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, leftAnkleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, rightAnkleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX - 0.005, leftAnkleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX + 0.005, rightAnkleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02, leftAnkleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.02, rightAnkleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// TANDEM STAND — front-facing, heel-to-toe stance. Body still, slight sway.
// ────────────────────────────────────────────────────────────────────────
//
// In a real tandem stance from front camera:
//   - Both ankles close in x (heel-to-toe is a near-vertical line)
//   - The AHEAD foot is closer to the camera, foreshortened, so renders
//     slightly LOWER in frame (higher y) — we model this with a small dy.
//   - Body upright, hands on hips at hip-y level.
//   - Sway = small drift of the whole upper body (we move shoulders + hips
//     together, NOT the feet — feet stay planted).

export function buildTandemStandPose(intent: TandemStandPoseIntent = {}): PoseLandmarks {
  const {
    tandemAhead = 'left',
    ankleXSeparation = 0.030,
    swayX = 0,
    swayY = 0,
    handsOnHips = true,
    trunkLeanDeg = 0,
    bodyHeight = 0.70,
    shoulderRise = 0,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Canonical centre + dimensions
  const cx = 0.50;
  const baseAnkleY = 0.92;
  // 2026-05-25 round 13: allow overriding for the cal-reject regression test.
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipWidth = 0.12;
  const hipHalf = hipWidth / 2;
  const trunkHeight = 0.18;

  // Tandem feet: very close in x, slight y offset (ahead foot lower in frame).
  // ankleXSeparation = 0.030 (default) is well below the calibration threshold
  // 0.30 × shoulderWidth = 0.048 → passes "tandem feet" check.
  const ankleYOffset = shoulderWidth * 0.12;
  const leftAnkleY = tandemAhead === 'left' ? baseAnkleY + ankleYOffset / 2 : baseAnkleY - ankleYOffset / 2;
  const rightAnkleY = tandemAhead === 'right' ? baseAnkleY + ankleYOffset / 2 : baseAnkleY - ankleYOffset / 2;
  const ankleXLeft = cx - ankleXSeparation / 2;
  const ankleXRight = cx + ankleXSeparation / 2;

  // Upper body — applies sway + trunkLean + shoulderRise
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const hipMidX = cx + swayX;
  const hipMidY = baseAnkleY - 0.40 + swayY;          // hips ~0.40 above ankle
  const shoulderMidY = hipMidY - trunkHeight * Math.cos(leanRad) - shoulderRise;
  const shoulderXShift = Math.sin(leanRad) * trunkHeight;
  const shoulderMidX = hipMidX + shoulderXShift;

  // Head
  const headY = shoulderMidY - 0.10;
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Hands: handsOnHips → wrists at hip y level. Else arms slightly raised
  // (failing the calibration handsOnHips check).
  const wristY = handsOnHips ? hipMidY : shoulderMidY - 0.05;
  pose[IDX.leftElbow] = makeLandmark(hipMidX - hipHalf - 0.02, (shoulderMidY + hipMidY) / 2, visibility);
  pose[IDX.rightElbow] = makeLandmark(hipMidX + hipHalf + 0.02, (shoulderMidY + hipMidY) / 2, visibility);
  pose[IDX.leftWrist] = makeLandmark(hipMidX - hipHalf - 0.005, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(hipMidX + hipHalf + 0.005, wristY, visibility);

  // Knees (legs roughly straight in tandem stance)
  const kneeY = (hipMidY + baseAnkleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);

  // Ankles + heels + toes
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, leftAnkleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, rightAnkleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, leftAnkleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, rightAnkleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, leftAnkleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, rightAnkleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// BICEP CURL — front-facing standing pose with both arms parameterized.
// ────────────────────────────────────────────────────────────────────────
//
// Forearm rotates around the elbow as a 2D pendulum:
//   At flex θ:
//     RIGHT arm forearm direction = (-sin θ_rad, cos θ_rad)
//     LEFT  arm forearm direction = ( sin θ_rad, cos θ_rad)
//   At θ=0   → both forearms point straight down (palms forward by anatomy)
//   At θ=90  → forearms horizontal toward midline
//   At θ=180 → forearms straight up (wrist at shoulder height)
//
// The engine's `elbowFlexionDeg(shoulder, elbow, wrist)` is the angle
// (180° − interior angle at the elbow) — verified to return θ exactly for
// this geometry across the full 0–180° range.

const UPPER_ARM_L = 0.13;
const FOREARM_L = 0.13;

function curlArmGeometry(shoulderX: number, shoulderY: number, flexDeg: number, side: 'left' | 'right') {
  const thetaRad = (flexDeg * Math.PI) / 180;
  // Elbow sits directly below shoulder by UPPER_ARM_L. Small lateral offset
  // outward from the body so the arm doesn't visually overlap the torso.
  const lateralOffset = side === 'left' ? -0.005 : 0.005;
  const elbowX = shoulderX + lateralOffset;
  const elbowY = shoulderY + UPPER_ARM_L;
  const sign = side === 'right' ? -1 : 1;
  const wristX = elbowX + FOREARM_L * sign * Math.sin(thetaRad);
  const wristY = elbowY + FOREARM_L * Math.cos(thetaRad);
  return { elbowX, elbowY, wristX, wristY };
}

export function buildBicepCurlPose(intent: BicepCurlPoseIntent): PoseLandmarks {
  const {
    elbowFlexionDeg,
    leftElbowFlexionDeg,
    rightElbowFlexionDeg,
    feetWidthRatio = 1.0,
    torsoSwayX = 0,
    elbowDriftX = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Standing upright skeleton (similar to squat at kneeFlex=0)
  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = (cx - torsoSwayX) - ankleHalf;     // feet planted (no sway in feet)
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;
  const ankleY = baseAnkleY;

  // Vertical chain anchors (upper body sways with torsoSwayX)
  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;     // torso 0.18 tall
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms
  const leftFlex = leftElbowFlexionDeg ?? elbowFlexionDeg;
  const rightFlex = rightElbowFlexionDeg ?? elbowFlexionDeg;
  const leftArm = curlArmGeometry(leftShoulderX, shoulderMidY, leftFlex, 'left');
  const rightArm = curlArmGeometry(rightShoulderX, shoulderMidY, rightFlex, 'right');
  // Apply elbow drift (push elbows outward from torso along x). Symmetric.
  const driftSignLeft = -1;   // left elbow drifts further left
  const driftSignRight = 1;
  pose[IDX.leftElbow] = makeLandmark(leftArm.elbowX + driftSignLeft * elbowDriftX, leftArm.elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX + driftSignRight * elbowDriftX, rightArm.elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftArm.wristX + driftSignLeft * elbowDriftX, leftArm.wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightArm.wristX + driftSignRight * elbowDriftX, rightArm.wristY, visibility);

  // Legs (standing straight)
  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// LUNGE — front-facing pose. One leg active (flexes), one straight (back).
// ────────────────────────────────────────────────────────────────────────
//
// Per-leg geometry reuses squat's `legGeometry` (isoceles knee bend with the
// hip directly above the ankle). Front leg uses target flex θ; back leg uses
// a small fixed flex (~0°) so it appears straight.
//
// In 2D front-view, a real forward lunge has the front leg compressed (low
// hip, bent knee) and the back leg extended (higher hip, straight knee). The
// engine reads each leg independently — there's no pelvis-rigidity constraint
// — so per-leg legGeometry gives the right shape at the engine level even
// though the resulting "hip pair" is split vertically (which is physically
// what happens when one side compresses).

export function buildLungePose(intent: LungePoseIntent): PoseLandmarks {
  const {
    kneeFlexionDeg,
    frontLeg = 'left',
    backLegFlexionDeg = 0,
    feetWidthRatio = 1.0,
    armsAtSides = true,
    valgusRatio = 0,
    trunkLeanDeg = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const ankleY = baseAnkleY;

  // Shoulder + ankle widths (calibration: feet roughly hip-width)
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;

  // Per-leg flex assignment
  const leftFlex = frontLeg === 'left' ? kneeFlexionDeg : backLegFlexionDeg;
  const rightFlex = frontLeg === 'right' ? kneeFlexionDeg : backLegFlexionDeg;

  const left = legGeometry(ankleXLeft, ankleY, leftFlex, -1);
  const right = legGeometry(ankleXRight, ankleY, rightFlex, +1);

  // Apply valgus to the FRONT knee only (drag it toward midline)
  const valgusPull = valgusRatio * 0.06;
  const adjLeftKneeX = frontLeg === 'left' ? left.kneeX + valgusPull : left.kneeX;
  const adjRightKneeX = frontLeg === 'right' ? right.kneeX - valgusPull : right.kneeX;

  // Shoulders sit above the hip midpoint by torso height.
  // Hip midpoint is the average of the two hips (which can differ in y
  // when one leg flexes and the other doesn't — that's biomechanically real).
  const hipMidX = (left.hipX + right.hipX) / 2;
  const hipMidY = (left.hipY + right.hipY) / 2;
  const torsoHeight = 0.18;

  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderY = hipMidY - torsoHeight * Math.cos(leanRad);
  const shoulderXShift = Math.sin(leanRad) * torsoHeight;

  const headY = shoulderY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(hipMidX + shoulderXShift, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(hipMidX - 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(hipMidX + 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(hipMidX - 0.035 + shoulderXShift, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(hipMidX + 0.035 + shoulderXShift, headY, visibility);

  // Shoulders
  pose[IDX.leftShoulder] = makeLandmark(hipMidX - shoulderHalf + shoulderXShift, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(hipMidX + shoulderHalf + shoulderXShift, shoulderY, visibility);

  // Arms (at sides for lunge calibration; flexed slightly during rep)
  if (armsAtSides) {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.18, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.18, visibility);
  } else {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY - 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY - 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY - 0.20, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY - 0.20, visibility);
  }

  // Hips
  pose[IDX.leftHip] = makeLandmark(left.hipX, left.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(right.hipX, right.hipY, visibility);

  // Knees (with valgus adjustment on front leg)
  pose[IDX.leftKnee] = makeLandmark(adjLeftKneeX, left.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(adjRightKneeX, right.kneeY, visibility);

  // Ankles
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);

  // Heels + toes (rough)
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// LATERAL LUNGE — front-facing pose. One leg steps WIDE to the side and bends
// (working leg); the other stays planted and straight. The pelvis shifts toward
// the working side as `lateralShift` grows (the working foot steps out beyond
// hip-width and the working hip sits over it).
// ────────────────────────────────────────────────────────────────────────
export function buildLateralLungePose(intent: LateralLungePoseIntent): PoseLandmarks {
  const {
    workingKneeFlexionDeg,
    straightLegFlexionDeg = 5,
    workingSide = 'left',
    lateralShift = 0,
    feetWidthRatio = 1.0,
    armsAtSides = true,
    valgusRatio = 0,
    trunkLeanDeg = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const ankleY = 0.92;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipWidthHalf = (shoulderWidth * feetWidthRatio) / 2;

  const leftIsWorking = workingSide === 'left';
  const sideSign = leftIsWorking ? -1 : 1;

  // Working foot steps wide (beyond hip-width by lateralShift); planted foot
  // stays at hip-width on the opposite side.
  const leftAnkleX = cx - hipWidthHalf - (leftIsWorking ? lateralShift : 0);
  const rightAnkleX = cx + hipWidthHalf + (!leftIsWorking ? lateralShift : 0);

  const leftFlex = leftIsWorking ? workingKneeFlexionDeg : straightLegFlexionDeg;
  const rightFlex = !leftIsWorking ? workingKneeFlexionDeg : straightLegFlexionDeg;

  const left = legGeometry(leftAnkleX, ankleY, leftFlex, -1);
  const right = legGeometry(rightAnkleX, ankleY, rightFlex, +1);

  // Valgus drags the WORKING knee toward the body midline (cx).
  const adjLeftKneeX = leftIsWorking ? left.kneeX * (1 - valgusRatio) + cx * valgusRatio : left.kneeX;
  const adjRightKneeX = !leftIsWorking ? right.kneeX * (1 - valgusRatio) + cx * valgusRatio : right.kneeX;

  const hipMidX = (left.hipX + right.hipX) / 2;
  const hipMidY = (left.hipY + right.hipY) / 2;
  const torsoHeight = 0.18;

  // Lateral trunk lean collapses toward the working side.
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderY = hipMidY - torsoHeight * Math.cos(leanRad);
  const shoulderXShift = sideSign * Math.sin(leanRad) * torsoHeight;

  const headY = shoulderY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(hipMidX + shoulderXShift, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(hipMidX - 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(hipMidX + 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(hipMidX - 0.035 + shoulderXShift, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(hipMidX + 0.035 + shoulderXShift, headY, visibility);

  // Shoulders
  pose[IDX.leftShoulder] = makeLandmark(hipMidX - shoulderHalf + shoulderXShift, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(hipMidX + shoulderHalf + shoulderXShift, shoulderY, visibility);

  // Arms (at sides for calibration; lifted otherwise)
  if (armsAtSides) {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.18, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.18, visibility);
  } else {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY - 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY - 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY - 0.20, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY - 0.20, visibility);
  }

  // Hips
  pose[IDX.leftHip] = makeLandmark(left.hipX, left.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(right.hipX, right.hipY, visibility);

  // Knees (with valgus adjustment on the working leg)
  pose[IDX.leftKnee] = makeLandmark(adjLeftKneeX, left.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(adjRightKneeX, right.kneeY, visibility);

  // Ankles
  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, ankleY, visibility);

  // Heels + toes (rough)
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// COSSACK SQUAT — front-on, FIXED wide stance. The working leg bends deep while
// the other stays straight; the pelvis (hips + upper body) shifts laterally
// over the working leg by `hipShift` — the feet do NOT move (unlike the lateral
// lunge, where the foot steps out).
// ────────────────────────────────────────────────────────────────────────

export function buildCossackSquatPose(intent: CossackSquatPoseIntent): PoseLandmarks {
  const {
    workingKneeFlexionDeg,
    straightLegFlexionDeg = 5,
    workingSide = 'left',
    hipShift = 0,
    feetWidthRatio = 1.8,
    armsAtSides = true,
    valgusRatio = 0,
    trunkLeanDeg = 0,
    shoulderWidthOverride,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const ankleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const wideHalf = (shoulderWidth * feetWidthRatio) / 2;

  const leftIsWorking = workingSide === 'left';
  const sideSign = leftIsWorking ? -1 : 1;

  // Fixed wide stance — both ankles planted, symmetric about centre.
  const leftAnkleX = cx - wideHalf;
  const rightAnkleX = cx + wideHalf;

  const leftFlex = leftIsWorking ? workingKneeFlexionDeg : straightLegFlexionDeg;
  const rightFlex = leftIsWorking ? straightLegFlexionDeg : workingKneeFlexionDeg;

  const left = legGeometry(leftAnkleX, ankleY, leftFlex, -1);
  const right = legGeometry(rightAnkleX, ankleY, rightFlex, +1);

  // Pelvis + upper body translate toward the working side by `hipShift` (feet
  // stay put). This is the lateral weight-shift the engine measures.
  const dx = sideSign * hipShift;

  const leftHipX = left.hipX + dx;
  const rightHipX = right.hipX + dx;
  const hipMidX = (leftHipX + rightHipX) / 2;        // = cx + dx
  const hipMidY = (left.hipY + right.hipY) / 2;
  const torsoHeight = 0.18;

  // Trunk lean toward the working side (extra, on top of the pelvis shift).
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderY = hipMidY - torsoHeight * Math.cos(leanRad);
  const shoulderMidX = hipMidX + sideSign * Math.sin(leanRad) * torsoHeight;
  const headY = shoulderY - 0.10;

  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderY, visibility);

  if (armsAtSides) {
    pose[IDX.leftElbow] = makeLandmark(shoulderMidX - shoulderHalf - 0.01, shoulderY + 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(shoulderMidX + shoulderHalf + 0.01, shoulderY + 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(shoulderMidX - shoulderHalf - 0.01, shoulderY + 0.18, visibility);
    pose[IDX.rightWrist] = makeLandmark(shoulderMidX + shoulderHalf + 0.01, shoulderY + 0.18, visibility);
  } else {
    pose[IDX.leftElbow] = makeLandmark(shoulderMidX - shoulderHalf - 0.01, shoulderY - 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(shoulderMidX + shoulderHalf + 0.01, shoulderY - 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(shoulderMidX - shoulderHalf - 0.01, shoulderY - 0.20, visibility);
    pose[IDX.rightWrist] = makeLandmark(shoulderMidX + shoulderHalf + 0.01, shoulderY - 0.20, visibility);
  }

  pose[IDX.leftHip] = makeLandmark(leftHipX, left.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, right.hipY, visibility);

  // Knees translate with the pelvis (dx); valgus drags the WORKING knee toward
  // the body midline (cx).
  const leftKneeShifted = left.kneeX + dx;
  const rightKneeShifted = right.kneeX + dx;
  const adjLeftKneeX = leftIsWorking ? leftKneeShifted * (1 - valgusRatio) + cx * valgusRatio : leftKneeShifted;
  const adjRightKneeX = !leftIsWorking ? rightKneeShifted * (1 - valgusRatio) + cx * valgusRatio : rightKneeShifted;
  pose[IDX.leftKnee] = makeLandmark(adjLeftKneeX, left.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(adjRightKneeX, right.kneeY, visibility);

  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// CAT-COW — SIDE-ON quadruped (on hands and knees). Spine (shoulder→hip)
// roughly horizontal; wrists below the shoulders and knees below the hips on
// the floor. The nose sits beyond the shoulder, and its HEIGHT relative to the
// shoulder encodes the cat-cow signal (above = cow/extension, below = cat).
// ────────────────────────────────────────────────────────────────────────

export function buildCatCowPose(intent: CatCowPoseIntent): PoseLandmarks {
  const {
    neckPitchDeg,
    side = 'left',
    backTiltDeg = 0,
    bodyLengthX = 0.35,
    hipDriftX = 0,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();
  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1; // front of the body toward +x for 'left'

  const FLOOR_Y = 0.80;
  const BACK_Y = 0.55;                 // spine height (shoulders + hips)
  const HIP_X = 0.50 - forwardSign * (bodyLengthX / 2); // pelvis at the back
  const torsoLen = bodyLengthX;        // hip → shoulder horizontal length

  // Shoulder rotates around the hip by backTilt (0 = level back).
  const tilt = (backTiltDeg * Math.PI) / 180;
  const shoulderX = HIP_X + forwardSign * torsoLen * Math.cos(tilt);
  const shoulderY = BACK_Y - torsoLen * Math.sin(tilt);

  const hipX = HIP_X + hipDriftX;       // rocking drifts the pelvis horizontally
  const kneeX = hipX;                   // knee below hip, on the floor
  const wristX = shoulderX;             // wrist below shoulder, on the floor

  // Nose beyond the shoulder; its pitch off horizontal is the cat-cow signal.
  const neckLen = 0.10;
  const noseX = shoulderX + forwardSign * neckLen;
  const noseY = shoulderY - Math.tan((neckPitchDeg * Math.PI) / 180) * neckLen;
  const headY = noseY - 0.01;

  const visScore = visibility;
  const hidScore = visibility * 0.5;

  // Head (shared / camera-facing).
  pose[IDX.nose] = makeLandmark(noseX, noseY, visScore);
  pose[IDX.leftEye] = makeLandmark(noseX - forwardSign * 0.01, headY, side === 'left' ? visScore : hidScore);
  pose[IDX.rightEye] = makeLandmark(noseX - forwardSign * 0.01, headY, side === 'right' ? visScore : hidScore);
  pose[IDX.leftEar] = makeLandmark(shoulderX + forwardSign * 0.03, shoulderY - 0.02, side === 'left' ? visScore : hidScore);
  pose[IDX.rightEar] = makeLandmark(shoulderX + forwardSign * 0.03, shoulderY - 0.02, side === 'right' ? visScore : hidScore);

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
  const hiddenKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
  const hiddenWrist = side === 'left' ? IDX.rightWrist : IDX.leftWrist;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const hiddenElbow = side === 'left' ? IDX.rightElbow : IDX.leftElbow;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;

  pose[visibleSh] = makeLandmark(shoulderX, shoulderY, visScore);
  pose[visibleHip] = makeLandmark(hipX, BACK_Y, visScore);
  pose[visibleKnee] = makeLandmark(kneeX, FLOOR_Y, visScore);
  pose[visibleWrist] = makeLandmark(wristX, FLOOR_Y, visScore);
  pose[visibleElbow] = makeLandmark((shoulderX + wristX) / 2, (shoulderY + FLOOR_Y) / 2, visScore);
  // Shin folds back from the knee (toes behind), ankle off the floor a touch.
  pose[visibleAnkle] = makeLandmark(kneeX - forwardSign * 0.06, FLOOR_Y - 0.03, visScore);

  pose[hiddenSh] = makeLandmark(shoulderX - 0.005, shoulderY + 0.003, hidScore);
  pose[hiddenHip] = makeLandmark(hipX - 0.005, BACK_Y + 0.003, hidScore);
  pose[hiddenKnee] = makeLandmark(kneeX - 0.005, FLOOR_Y + 0.003, hidScore);
  pose[hiddenWrist] = makeLandmark(wristX - 0.005, FLOOR_Y + 0.003, hidScore);
  pose[hiddenElbow] = makeLandmark((shoulderX + wristX) / 2 - 0.005, (shoulderY + FLOOR_Y) / 2, hidScore);
  pose[hiddenAnkle] = makeLandmark(kneeX - forwardSign * 0.06 - 0.005, FLOOR_Y - 0.03, hidScore);

  pose[visibleSh === IDX.leftShoulder ? IDX.leftHeel : IDX.rightHeel] = makeLandmark(kneeX - forwardSign * 0.07, FLOOR_Y - 0.02, visScore);
  pose[visibleSh === IDX.leftShoulder ? IDX.leftFootIndex : IDX.rightFootIndex] = makeLandmark(kneeX - forwardSign * 0.04, FLOOR_Y, visScore);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// PUSH-UP — side-facing pose. Body horizontal, arms anchored at floor.
// ────────────────────────────────────────────────────────────────────────
//
// Per-arm geometry mirrors squat's isoceles model (kneeFlexionDeg pattern):
//   wrist anchored on floor (vertically below shoulder when arms straight)
//   shoulder-wrist distance shrinks as flex grows: |S - W| = 2L·cos(θ/2)
//   elbow on perpendicular bisector at offset L·sin(θ/2) toward feet
//
// At flex 0°: shoulder directly above wrist by 2L (top of push-up, body high).
// At flex 90°: shoulder-wrist distance ≈ 1.41L (body lowered, elbow out).
//
// The body line (shoulder→hip→ankle) is horizontal at shoulder.y, which itself
// drops as flex grows. This stays consistent with the engine's expectations
// (sag/pike measured relative to baseline hipY captured at calibration when
// flex=0; rep cycle changes shoulder.y but hip stays on the body line).

const ARM_L = 0.18; // upper-arm and forearm length each

function armGeometry(shoulderX: number, floorY: number, flexDeg: number, flareOverride: boolean) {
  const halfRad = (flexDeg / 2) * Math.PI / 180;
  const baseLen = 2 * ARM_L * Math.cos(halfRad);
  const offset = ARM_L * Math.sin(halfRad);

  const shoulderY = floorY - baseLen;
  const wristX = shoulderX;
  const wristY = floorY;
  const midY = floorY - baseLen / 2;
  // Tucked form: elbow offset toward feet (+x in this layout).
  // Flare override: elbow x nearly under shoulder (engine detects this as flare).
  const elbowX = flareOverride ? shoulderX + 0.01 : shoulderX + offset;
  const elbowY = midY;
  return { shoulderY, wristX, wristY, elbowX, elbowY };
}

export function buildPushupPose(intent: PushupPoseIntent): PoseLandmarks {
  const {
    elbowFlexionDeg,
    side = 'left',
    bodyLengthX = 0.70,
    hipDelta = 0,
    spineDeviationDeg = 0,
    elbowFlare = false,
    leftElbowFlexionDeg,
    rightElbowFlexionDeg,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const shoulderX = 0.15;
  const ankleX = shoulderX + bodyLengthX;
  const hipX = (shoulderX + ankleX) / 2;
  const floorY = 0.85;

  const visibleFlex = side === 'left'
    ? (leftElbowFlexionDeg ?? elbowFlexionDeg)
    : (rightElbowFlexionDeg ?? elbowFlexionDeg);
  const hiddenFlex = side === 'left'
    ? (rightElbowFlexionDeg ?? elbowFlexionDeg)
    : (leftElbowFlexionDeg ?? elbowFlexionDeg);

  const visArm = armGeometry(shoulderX, floorY, visibleFlex, elbowFlare);
  // Hidden side mirrored slightly inward (closer to body axis in 2D)
  const hidArm = armGeometry(shoulderX + 0.005, floorY, hiddenFlex, elbowFlare);

  const shoulderY = visArm.shoulderY;

  // Hip on body line + sag/pike + spine kink
  let hipY = shoulderY + hipDelta;
  if (spineDeviationDeg !== 0) {
    hipY += Math.sin((spineDeviationDeg * Math.PI) / 180) * 0.04;
  }
  const ankleY = shoulderY;

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const hiddenElbow = side === 'left' ? IDX.rightElbow : IDX.leftElbow;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
  const hiddenWrist = side === 'left' ? IDX.rightWrist : IDX.leftWrist;

  // Visible side — full visibility
  pose[visibleSh] = makeLandmark(shoulderX, shoulderY, visibility);
  pose[visibleHip] = makeLandmark(hipX, hipY, visibility);
  pose[visibleAnkle] = makeLandmark(ankleX, ankleY, visibility);
  pose[visibleElbow] = makeLandmark(visArm.elbowX, visArm.elbowY, visibility);
  pose[visibleWrist] = makeLandmark(visArm.wristX, visArm.wristY, visibility);

  // Hidden side — reduced visibility (still above VIS_THRESHOLD=0.3 by default)
  pose[hiddenSh] = makeLandmark(shoulderX + 0.005, shoulderY + 0.005, visibility * 0.5);
  pose[hiddenHip] = makeLandmark(hipX + 0.005, hipY + 0.005, visibility * 0.5);
  pose[hiddenAnkle] = makeLandmark(ankleX - 0.005, ankleY + 0.005, visibility * 0.5);
  pose[hiddenElbow] = makeLandmark(hidArm.elbowX, hidArm.elbowY, visibility * 0.5);
  pose[hiddenWrist] = makeLandmark(hidArm.wristX, hidArm.wristY, visibility * 0.5);

  // Head — slightly past the visible shoulder (toward head direction = -x here)
  const noseY = shoulderY - 0.02;
  pose[IDX.nose] = makeLandmark(shoulderX - 0.05, noseY, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderX - 0.04, shoulderY - 0.03, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderX - 0.04, shoulderY - 0.03, visibility * 0.5);

  // Knees on body line
  const kneeX = (hipX + ankleX) / 2;
  const kneeY = (hipY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(kneeX, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(kneeX, kneeY + 0.005, visibility * 0.5);

  // Heels + toes
  pose[IDX.leftHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleX - 0.012, ankleY + 0.012, visibility * 0.5);
  pose[IDX.leftFootIndex] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleX + 0.02, ankleY + 0.008, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// PLANK — side-facing pose (left side visible by default)
// ────────────────────────────────────────────────────────────────────────

export function buildPlankPose(intent: PlankPoseIntent = {}): PoseLandmarks {
  const {
    hipDelta = 0,
    spineDeviationDeg = 0,
    neckDroop = 0,
    shoulderRise = 0,
    side = 'left',
    bodyLengthX = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const shoulderX = 0.15;
  const ankleX = shoulderX + bodyLengthX;
  const hipX = (shoulderX + ankleX) / 2;
  const baseY = 0.50;

  const shoulderY = baseY - shoulderRise;
  let hipY = baseY + hipDelta;
  if (spineDeviationDeg !== 0) {
    hipY += Math.sin((spineDeviationDeg * Math.PI) / 180) * 0.04;
  }
  const ankleY = baseY;

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;

  // Visible side
  pose[visibleSh] = makeLandmark(shoulderX, shoulderY, visibility);
  pose[visibleHip] = makeLandmark(hipX, hipY, visibility);
  pose[visibleAnkle] = makeLandmark(ankleX, ankleY, visibility);
  pose[visibleElbow] = makeLandmark(shoulderX, shoulderY + 0.12, visibility);
  pose[visibleWrist] = makeLandmark(shoulderX + 0.07, shoulderY + 0.12, visibility);

  // Hidden side (lower visibility)
  pose[hiddenSh] = makeLandmark(shoulderX - 0.01, shoulderY + 0.005, visibility * 0.5);
  pose[hiddenHip] = makeLandmark(hipX - 0.01, hipY + 0.005, visibility * 0.5);
  pose[hiddenAnkle] = makeLandmark(ankleX - 0.01, ankleY + 0.005, visibility * 0.5);

  // Head
  const noseY = shoulderY - 0.02 + neckDroop;
  pose[IDX.nose] = makeLandmark(shoulderX - 0.05, noseY, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderX - 0.04, shoulderY - 0.03, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderX - 0.04, shoulderY - 0.03, visibility * 0.5);

  // Knees
  const kneeX = (hipX + ankleX) / 2;
  const kneeY = (hipY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(kneeX, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(kneeX - 0.01, kneeY + 0.005, visibility * 0.5);

  // Heels + toes
  pose[IDX.leftHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleX - 0.015, ankleY + 0.012, visibility * 0.5);
  pose[IDX.leftFootIndex] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleX + 0.02, ankleY + 0.008, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// CHAIR POSE — side-facing standing pose with knees bent into a partial squat
// ────────────────────────────────────────────────────────────────────────
//
// Geometry (verified to satisfy squat/geometry kneeFlexionDeg = θ):
//   ankle = (ankleX, ankleY)
//   knee  = (ankleX, ankleY − L_SHIN)              // shin vertical
//   hip   = knee + L_THIGH · (−forwardSign·sin θ, −cos θ)
// At θ=0: hip directly above knee (straight leg). At θ=90: hip horizontal
// to knee (thighs parallel). Trunk continues from hip upward with optional
// forward lean.
//
// `forwardSign` = +1 if user's LEFT side faces the camera (user facing +X),
//                 −1 if RIGHT side faces camera (user facing −X).
// During chair pose hips push BACK opposite to forwardSign.

const CP_SHIN_LEN = 0.18;
const CP_THIGH_LEN = 0.20;
const CP_TRUNK_LEN = 0.28;

export function buildChairPosePose(intent: ChairPosePoseIntent): PoseLandmarks {
  const {
    kneeFlexionDeg,
    trunkLeanDeg = 5,
    heelLift = 0,
    shoulderRise = 0,
    side = 'left',
    bodyHeight: targetBodyHeight = 0.65,
    armsExtended = true,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1;

  const ankleY = 0.90 - heelLift;
  const kneeY = ankleY - CP_SHIN_LEN;
  const kneeX = 0.50;
  const ankleX = kneeX;

  const theta = (kneeFlexionDeg * Math.PI) / 180;
  const hipX = kneeX + CP_THIGH_LEN * (-forwardSign * Math.sin(theta));
  const hipY = kneeY - CP_THIGH_LEN * Math.cos(theta);

  const lean = (trunkLeanDeg * Math.PI) / 180;
  const shoulderXBase = hipX + CP_TRUNK_LEN * (forwardSign * Math.sin(lean));
  const shoulderYBase = hipY - CP_TRUNK_LEN * Math.cos(lean);

  // bodyHeight = |ankle.y − shoulder.y| at the BASELINE (shoulderRise=0). Scale
  // entire body about the ankle so the baseline span matches targetBodyHeight
  // while preserving all joint angles (engine still reads the requested
  // kneeFlexionDeg). shoulderRise is applied AFTER scaling so a 0.12 rise is
  // always 0.12 in screen-normalized coords, regardless of body scale.
  const naturalSpan = Math.abs(ankleY - shoulderYBase);
  const scale = targetBodyHeight / naturalSpan;
  const scaleAroundAnkle = (px: number, py: number): { x: number; y: number } => ({
    x: ankleX + (px - ankleX) * scale,
    y: ankleY - (ankleY - py) * scale,
  });

  const Knee = scaleAroundAnkle(kneeX, kneeY);
  const Hip = scaleAroundAnkle(hipX, hipY);
  const ShoulderBase = scaleAroundAnkle(shoulderXBase, shoulderYBase);
  // Apply shoulderRise in screen-coord space (post-scale) so the engine's
  // 0.12 threshold matches the test's intuition.
  const Shoulder = { x: ShoulderBase.x, y: ShoulderBase.y - shoulderRise };

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
  const hiddenKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visibleHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
  const visibleFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;

  pose[visibleSh] = makeLandmark(Shoulder.x, Shoulder.y, visibility);
  pose[visibleHip] = makeLandmark(Hip.x, Hip.y, visibility);
  pose[visibleKnee] = makeLandmark(Knee.x, Knee.y, visibility);
  pose[visibleAnkle] = makeLandmark(ankleX, ankleY, visibility);
  pose[visibleHeel] = makeLandmark(ankleX - forwardSign * 0.02, ankleY + 0.01, visibility);
  pose[visibleFoot] = makeLandmark(ankleX + forwardSign * 0.03, ankleY + 0.005, visibility);

  pose[hiddenSh] = makeLandmark(Shoulder.x - 0.005, Shoulder.y + 0.003, visibility * 0.5);
  pose[hiddenHip] = makeLandmark(Hip.x - 0.005, Hip.y + 0.003, visibility * 0.5);
  pose[hiddenKnee] = makeLandmark(Knee.x - 0.005, Knee.y + 0.003, visibility * 0.5);
  pose[hiddenAnkle] = makeLandmark(ankleX - 0.005, ankleY + 0.003, visibility * 0.5);

  const headX = Shoulder.x + forwardSign * 0.02;
  const headY = Shoulder.y - 0.06;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEar] = makeLandmark(Shoulder.x, Shoulder.y - 0.04, visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(Shoulder.x, Shoulder.y - 0.04, visibility * (side === 'right' ? 1 : 0.5));
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);

  if (armsExtended) {
    const elbowX = Shoulder.x + forwardSign * 0.10;
    const elbowY = Shoulder.y + 0.02;
    const wristX = Shoulder.x + forwardSign * 0.20;
    const wristY = Shoulder.y;
    pose[visibleElbow] = makeLandmark(elbowX, elbowY, visibility);
    pose[visibleWrist] = makeLandmark(wristX, wristY, visibility);
  } else {
    pose[visibleElbow] = makeLandmark(Shoulder.x + 0.005, Shoulder.y + 0.15, visibility);
    pose[visibleWrist] = makeLandmark(Shoulder.x + 0.01, Shoulder.y + 0.27, visibility);
  }

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// WALL SIT — side-facing pose, back vertical against a wall, knees bent.
// Geometrically identical to Chair Pose, so we reuse buildChairPosePose. Arms
// hang relaxed at the sides (wall sit does not gate arm position). The default
// trunkLeanDeg is small so the back reads as flat against the wall.
// ────────────────────────────────────────────────────────────────────────
export function buildWallSitPose(intent: WallSitPoseIntent): PoseLandmarks {
  const { kneeFlexionDeg, trunkLeanDeg = 4, ...rest } = intent;
  return buildChairPosePose({
    kneeFlexionDeg,
    trunkLeanDeg,
    armsExtended: false,
    ...rest,
  });
}

// ────────────────────────────────────────────────────────────────────────
// STANDING FORWARD FOLD — side-facing hip hinge. Legs near-straight, torso
// folds forward by foldAngleDeg. Geometrically identical to Chair Pose
// (knee flexion + trunk fold), so delegate to buildChairPosePose with
// trunkLeanDeg = foldAngleDeg. Arms hang (the engine doesn't read arm position).
// ────────────────────────────────────────────────────────────────────────
export function buildForwardFoldPose(intent: ForwardFoldPoseIntent): PoseLandmarks {
  const { foldAngleDeg, kneeFlexionDeg = 5, bodyHeight = 0.60, ...rest } = intent;
  return buildChairPosePose({
    kneeFlexionDeg,
    trunkLeanDeg: foldAngleDeg,
    armsExtended: false,
    bodyHeight,
    ...rest,
  });
}

// ────────────────────────────────────────────────────────────────────────
// DOWNWARD DOG — side-facing inverted V. Hip is the apex; the torso/arm reaches
// down-forward to the hands, the legs reach down-back to the feet, each limb at
// ±(apex/2) from the downward vertical. Constructed so the engine reads back the
// requested hip apex interior angle, then scaled about the hip so |ankleY−hipY|
// = bodyHeight (uniform scale preserves all angles).
// ────────────────────────────────────────────────────────────────────────
const DD_LIMB = 0.34;   // hip→shoulder and hip→ankle length (pre-scale)
const DD_ARM = 0.22;    // shoulder→wrist length (continues the arm line)

export function buildDownwardDogPose(intent: DownwardDogPoseIntent): PoseLandmarks {
  const {
    apexAngleDeg,
    side = 'left',
    bodyHeight = 0.35,
    kneeFlexionDeg = 0,
    armFlexionDeg = 0,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();
  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1; // hands toward +x for 'left'

  const half = (apexAngleDeg / 2) * (Math.PI / 180);
  const sinH = Math.sin(half);
  const cosH = Math.cos(half);

  const HIP_X = 0.50, HIP_Y = 0.30;

  // Pre-scale joint positions.
  const shoulderX0 = HIP_X + forwardSign * sinH * DD_LIMB;
  const shoulderY0 = HIP_Y + cosH * DD_LIMB;
  const ankleX0 = HIP_X - forwardSign * sinH * DD_LIMB;
  const ankleY0 = HIP_Y + cosH * DD_LIMB;
  // Knee at the hip→ankle midpoint, offset perpendicular by d = (D/2)·tan(θ/2)
  // so kneeFlexionDeg(hip,knee,ankle) reads back kneeFlexionDeg (0 = collinear =
  // straight). Leg direction unit vector = (−forwardSign·sinH, cosH); perp = (cosH, forwardSign·sinH).
  const kneeBend = (DD_LIMB / 2) * Math.tan((kneeFlexionDeg * Math.PI) / 180 / 2);
  const kneeX0 = (HIP_X - forwardSign * sinH * DD_LIMB * 0.5) + cosH * kneeBend;
  const kneeY0 = (HIP_Y + cosH * DD_LIMB * 0.5) + forwardSign * sinH * kneeBend;
  const wristX0 = shoulderX0 + forwardSign * sinH * DD_ARM;
  const wristY0 = shoulderY0 + cosH * DD_ARM;
  // Elbow at the shoulder→wrist midpoint, offset perpendicular by armFlexionDeg.
  // Arm direction unit vector = (forwardSign·sinH, cosH); perp = (cosH, −forwardSign·sinH).
  const armBend = (DD_ARM / 2) * Math.tan((armFlexionDeg * Math.PI) / 180 / 2);
  const elbowX0 = ((shoulderX0 + wristX0) / 2) + cosH * armBend;
  const elbowY0 = ((shoulderY0 + wristY0) / 2) - forwardSign * sinH * armBend;

  // Scale about the hip so |ankleY − hipY| = bodyHeight. cosH could be ~0 for a
  // near-flat V; clamp the natural drop so the scale stays finite.
  const naturalDrop = Math.max(0.02, cosH * DD_LIMB);
  const scale = bodyHeight / naturalDrop;
  const sx = (px: number) => HIP_X + (px - HIP_X) * scale;
  const sy = (py: number) => HIP_Y + (py - HIP_Y) * scale;

  const Shoulder = { x: sx(shoulderX0), y: sy(shoulderY0) };
  const Ankle = { x: sx(ankleX0), y: sy(ankleY0) };
  const Knee = { x: sx(kneeX0), y: sy(kneeY0) };
  const Wrist = { x: sx(wristX0), y: sy(wristY0) };
  const Elbow = { x: sx(elbowX0), y: sy(elbowY0) };

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
  const hiddenKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const hiddenElbow = side === 'left' ? IDX.rightElbow : IDX.leftElbow;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
  const hiddenWrist = side === 'left' ? IDX.rightWrist : IDX.leftWrist;
  const visibleHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
  const visibleFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;

  pose[visibleSh] = makeLandmark(Shoulder.x, Shoulder.y, visibility);
  pose[visibleHip] = makeLandmark(HIP_X, HIP_Y, visibility);
  pose[visibleKnee] = makeLandmark(Knee.x, Knee.y, visibility);
  pose[visibleAnkle] = makeLandmark(Ankle.x, Ankle.y, visibility);
  pose[visibleElbow] = makeLandmark(Elbow.x, Elbow.y, visibility);
  pose[visibleWrist] = makeLandmark(Wrist.x, Wrist.y, visibility);
  pose[visibleHeel] = makeLandmark(Ankle.x - forwardSign * 0.02, Ankle.y + 0.01, visibility);
  pose[visibleFoot] = makeLandmark(Ankle.x - forwardSign * 0.04, Ankle.y, visibility);

  // Hidden side mirrors at reduced visibility (side-view occlusion).
  pose[hiddenSh] = makeLandmark(Shoulder.x - 0.005, Shoulder.y + 0.003, visibility * 0.5);
  pose[hiddenHip] = makeLandmark(HIP_X - 0.005, HIP_Y + 0.003, visibility * 0.5);
  pose[hiddenKnee] = makeLandmark(Knee.x - 0.005, Knee.y + 0.003, visibility * 0.5);
  pose[hiddenAnkle] = makeLandmark(Ankle.x - 0.005, Ankle.y + 0.003, visibility * 0.5);
  pose[hiddenElbow] = makeLandmark(Elbow.x - 0.005, Elbow.y + 0.003, visibility * 0.5);
  pose[hiddenWrist] = makeLandmark(Wrist.x - 0.005, Wrist.y + 0.003, visibility * 0.5);

  // Head hangs between the arms, just beyond the shoulder along the arm line.
  const headX = Shoulder.x + forwardSign * 0.03;
  const headY = Shoulder.y + 0.03;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEar] = makeLandmark(Shoulder.x, Shoulder.y + 0.02, visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(Shoulder.x, Shoulder.y + 0.02, visibility * (side === 'right' ? 1 : 0.5));
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// COBRA POSE — side-facing prone backbend. The lower body lies flat along the
// floor (hip + ankle on a horizontal line); the torso lifts forward-and-up from
// the hip by elevationDeg. Scaled uniformly about the hip-on-floor anchor so
// |shoulderX − ankleX| = bodyLengthX (angles + the floor line are preserved).
// ────────────────────────────────────────────────────────────────────────
const CB_TORSO = 0.20;  // hip→shoulder length (pre-scale)
const CB_LEG = 0.30;    // hip→ankle length (pre-scale)

export function buildCobraPosePose(intent: CobraPosePoseIntent): PoseLandmarks {
  const {
    elevationDeg,
    side = 'left',
    bodyLengthX = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();
  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1; // head toward +x for 'left'

  const FLOOR_Y = 0.80;
  const HIP_X = 0.50;
  const elev = (elevationDeg * Math.PI) / 180;

  // Pre-scale positions. Hip + ankle on the floor; shoulder lifted from the hip.
  const shoulderX0 = HIP_X + forwardSign * CB_TORSO * Math.cos(elev);
  const shoulderY0 = FLOOR_Y - CB_TORSO * Math.sin(elev);
  const ankleX0 = HIP_X - forwardSign * CB_LEG;
  const ankleY0 = FLOOR_Y;
  const kneeX0 = HIP_X - forwardSign * CB_LEG * 0.5;
  const kneeY0 = FLOOR_Y;
  const wristX0 = shoulderX0 - forwardSign * 0.02; // hands under/just behind the shoulder
  const wristY0 = FLOOR_Y;
  const elbowX0 = (shoulderX0 + wristX0) / 2;
  const elbowY0 = (shoulderY0 + FLOOR_Y) / 2;

  // Scale about the hip-on-floor anchor so the horizontal span matches bodyLengthX.
  const naturalSpanX = CB_TORSO * Math.cos(elev) + CB_LEG;
  const scale = bodyLengthX / Math.max(naturalSpanX, 1e-6);
  const sx = (px: number) => HIP_X + (px - HIP_X) * scale;
  const sy = (py: number) => FLOOR_Y + (py - FLOOR_Y) * scale;

  const Shoulder = { x: sx(shoulderX0), y: sy(shoulderY0) };
  const Ankle = { x: sx(ankleX0), y: sy(ankleY0) };
  const Knee = { x: sx(kneeX0), y: sy(kneeY0) };
  const Wrist = { x: sx(wristX0), y: sy(wristY0) };
  const Elbow = { x: sx(elbowX0), y: sy(elbowY0) };

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
  const hiddenKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
  const visibleHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
  const visibleFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;

  pose[visibleSh] = makeLandmark(Shoulder.x, Shoulder.y, visibility);
  pose[visibleHip] = makeLandmark(HIP_X, FLOOR_Y, visibility);
  pose[visibleKnee] = makeLandmark(Knee.x, Knee.y, visibility);
  pose[visibleAnkle] = makeLandmark(Ankle.x, Ankle.y, visibility);
  pose[visibleElbow] = makeLandmark(Elbow.x, Elbow.y, visibility);
  pose[visibleWrist] = makeLandmark(Wrist.x, Wrist.y, visibility);
  pose[visibleHeel] = makeLandmark(Ankle.x - forwardSign * 0.02, Ankle.y, visibility);
  pose[visibleFoot] = makeLandmark(Ankle.x - forwardSign * 0.04, Ankle.y, visibility);

  pose[hiddenSh] = makeLandmark(Shoulder.x - 0.005, Shoulder.y + 0.003, visibility * 0.5);
  pose[hiddenHip] = makeLandmark(HIP_X - 0.005, FLOOR_Y + 0.003, visibility * 0.5);
  pose[hiddenKnee] = makeLandmark(Knee.x - 0.005, Knee.y + 0.003, visibility * 0.5);
  pose[hiddenAnkle] = makeLandmark(Ankle.x - 0.005, Ankle.y + 0.003, visibility * 0.5);

  // Head just forward-and-up of the shoulder.
  const headX = Shoulder.x + forwardSign * 0.03;
  const headY = Shoulder.y - 0.02;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEar] = makeLandmark(Shoulder.x, Shoulder.y - 0.01, visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(Shoulder.x, Shoulder.y - 0.01, visibility * (side === 'right' ? 1 : 0.5));
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// LATERAL RAISE — front-facing standing pose with both arms abducting
// ────────────────────────────────────────────────────────────────────────
//
// Per-arm geometry for abduction angle θ (where shoulderAbductionDeg = θ):
//   shoulder at (sx, sy), hip directly below shoulder.
//   wrist at (sx ± sin(θ)·L, sy + cos(θ)·L) — outward away from torso.
//     At θ=0:   wrist directly below shoulder (arms at sides). Verified to
//               produce shoulderAbductionDeg ≈ 0°.
//     At θ=90°: wrist at shoulder height, out to the side. Verified ≈ 90°.
//     At θ=180°: wrist directly above shoulder. Verified ≈ 180°.
//   Elbow placed midway between shoulder and wrist (slight bend allowed by
//   the calibration gate; engine doesn't read elbow position).

const LR_ARM_LEN = 0.22;

function lrArmGeometry(
  shoulderX: number,
  shoulderY: number,
  abductionDeg: number,
  side: 'left' | 'right',
) {
  const theta = (abductionDeg * Math.PI) / 180;
  const outwardSign = side === 'left' ? -1 : 1;
  const wristX = shoulderX + outwardSign * Math.sin(theta) * LR_ARM_LEN;
  const wristY = shoulderY + Math.cos(theta) * LR_ARM_LEN;
  const elbowX = (shoulderX + wristX) / 2;
  const elbowY = (shoulderY + wristY) / 2;
  return { elbowX, elbowY, wristX, wristY };
}

export function buildLateralRaisePose(intent: LateralRaisePoseIntent): PoseLandmarks {
  const {
    abductionDeg,
    leftAbductionDeg,
    rightAbductionDeg,
    feetWidthRatio = 1.0,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    wristForwardOverride = false,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = (cx - torsoSwayX) - ankleHalf;
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;
  const ankleY = baseAnkleY;

  // Vertical chain
  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms — abducted outward from shoulder by the per-arm angle
  const leftAbd = leftAbductionDeg ?? abductionDeg;
  const rightAbd = rightAbductionDeg ?? abductionDeg;
  const leftArm = lrArmGeometry(leftShoulderX, shoulderMidY, leftAbd, 'left');
  const rightArm = lrArmGeometry(rightShoulderX, shoulderMidY, rightAbd, 'right');
  pose[IDX.leftElbow] = makeLandmark(leftArm.elbowX, leftArm.elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX, rightArm.elbowY, visibility);
  // 2026-05-28 round 19: wristForwardOverride simulates a FRONT raise — keep
  // the wrist Y from lrArmGeometry (so abduction angle still hits target),
  // but place the wrist X near the shoulder X (no outward extension).
  if (wristForwardOverride) {
    pose[IDX.leftWrist] = makeLandmark(leftShoulderX + 0.005, leftArm.wristY, visibility);
    pose[IDX.rightWrist] = makeLandmark(rightShoulderX - 0.005, rightArm.wristY, visibility);
  } else {
    pose[IDX.leftWrist] = makeLandmark(leftArm.wristX, leftArm.wristY, visibility);
    pose[IDX.rightWrist] = makeLandmark(rightArm.wristX, rightArm.wristY, visibility);
  }

  // Legs (standing straight)
  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// TREE POSE — front-facing single-leg balance with lifted foot ON standing leg
// ────────────────────────────────────────────────────────────────────────
//
// Extends the SLS geometry with two changes:
//   1. Lifted ankle X is positioned NEAR the standing-knee X (not at the
//      lifted-foot-on-floor X). The `liftedAnkleXOffset` knob controls how
//      far the lifted ankle sits from the standing knee X.
//   2. Wrists default to chest level (prayer position) instead of at sides.

export function buildTreePosePose(intent: TreePosePoseIntent = {}): PoseLandmarks {
  const {
    liftedSide = 'left',
    liftElevation = 0.10,
    hipDrop = 0,
    liftedAnkleXOffset = 0,
    swayX = 0,
    swayY = 0,
    shoulderRise = 0,
    wrists = 'chest',
    bodyHeight = 0.70,
    shoulderWidthOverride,
    kneeLiftOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + swayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = 0.06;

  const hipMidY = baseAnkleY - 0.40 + swayY;
  const shoulderMidY = hipMidY - 0.18 - shoulderRise;
  const headY = shoulderMidY - 0.10;

  pose[IDX.nose] = makeLandmark(cx, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(cx - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(cx + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(cx - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(cx + 0.035, headY, visibility);

  pose[IDX.leftShoulder] = makeLandmark(cx - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf, shoulderMidY, visibility);

  const leftHipY = liftedSide === 'left' ? hipMidY + hipDrop : hipMidY;
  const rightHipY = liftedSide === 'right' ? hipMidY + hipDrop : hipMidY;
  pose[IDX.leftHip] = makeLandmark(cx - hipHalf, leftHipY, visibility);
  pose[IDX.rightHip] = makeLandmark(cx + hipHalf, rightHipY, visibility);

  let wristY: number;
  let wristX: number;
  if (wrists === 'overhead') {
    wristY = shoulderMidY - 0.10;
    wristX = cx;
  } else if (wrists === 'sides') {
    wristY = hipMidY + 0.04;
    wristX = cx;
  } else {
    wristY = (shoulderMidY + hipMidY) / 2 - 0.02;
    wristX = cx;
  }
  const elbowY = (shoulderMidY + wristY) / 2;
  pose[IDX.leftElbow] = makeLandmark(cx - 0.04, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + 0.04, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(wrists === 'sides' ? cx - hipHalf - 0.01 : wristX - 0.005, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(wrists === 'sides' ? cx + hipHalf + 0.01 : wristX + 0.005, wristY, visibility);

  const standingFootX = liftedSide === 'left' ? (cx - swayX) + 0.06 : (cx - swayX) - 0.06;
  const standingKneeX = standingFootX;
  const liftedAnkleX = standingKneeX + (liftedSide === 'left' ? -liftedAnkleXOffset : liftedAnkleXOffset);

  const liftedHipX = liftedSide === 'left' ? cx - hipHalf : cx + hipHalf;
  const liftedAnkleY = baseAnkleY - liftElevation;
  const liftedKneeX = (liftedHipX + liftedAnkleX) / 2 + (liftedSide === 'left' ? -0.03 : 0.03);
  const liftedHipY = liftedSide === 'left' ? leftHipY : rightHipY;
  const liftedKneeY = kneeLiftOverride !== undefined
    ? (liftedHipY + (baseAnkleY - kneeLiftOverride * 2)) / 2
    : (liftedHipY + liftedAnkleY) / 2;

  const standingAnkleY = baseAnkleY;
  const standingKneeY = (hipMidY + standingAnkleY) / 2;

  if (liftedSide === 'left') {
    pose[IDX.leftKnee] = makeLandmark(liftedKneeX, liftedKneeY, visibility);
    pose[IDX.rightKnee] = makeLandmark(standingKneeX, standingKneeY, visibility);
    pose[IDX.leftAnkle] = makeLandmark(liftedAnkleX, liftedAnkleY, visibility);
    pose[IDX.rightAnkle] = makeLandmark(standingFootX, standingAnkleY, visibility);
  } else {
    pose[IDX.leftKnee] = makeLandmark(standingKneeX, standingKneeY, visibility);
    pose[IDX.rightKnee] = makeLandmark(liftedKneeX, liftedKneeY, visibility);
    pose[IDX.leftAnkle] = makeLandmark(standingFootX, standingAnkleY, visibility);
    pose[IDX.rightAnkle] = makeLandmark(liftedAnkleX, liftedAnkleY, visibility);
  }

  pose[IDX.leftHeel] = makeLandmark(pose[IDX.leftAnkle].x - 0.005, pose[IDX.leftAnkle].y + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(pose[IDX.rightAnkle].x + 0.005, pose[IDX.rightAnkle].y + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(pose[IDX.leftAnkle].x + 0.02, pose[IDX.leftAnkle].y, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(pose[IDX.rightAnkle].x - 0.02, pose[IDX.rightAnkle].y, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// STANDING FIGURE-4 — single-leg, the crossed ankle rests at the standing
// knee (near the standing-knee X, elevated). Geometrically the same as Tree
// Pose's "free foot on the standing leg"; reuses the same construction.
// ────────────────────────────────────────────────────────────────────────

export function buildStandingFigure4Pose(intent: StandingFigure4PoseIntent = {}): PoseLandmarks {
  const {
    liftedSide = 'left',
    liftElevation = 0.10,
    hipDrop = 0,
    liftedAnkleXOffset = 0,
    swayX = 0,
    swayY = 0,
    shoulderRise = 0,
    wrists = 'chest',
    bodyHeight = 0.70,
    shoulderWidthOverride,
    kneeLiftOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + swayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = 0.06;

  const hipMidY = baseAnkleY - 0.40 + swayY;
  const shoulderMidY = hipMidY - 0.18 - shoulderRise;
  const headY = shoulderMidY - 0.10;

  pose[IDX.nose] = makeLandmark(cx, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(cx - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(cx + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(cx - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(cx + 0.035, headY, visibility);

  pose[IDX.leftShoulder] = makeLandmark(cx - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf, shoulderMidY, visibility);

  const leftHipY = liftedSide === 'left' ? hipMidY + hipDrop : hipMidY;
  const rightHipY = liftedSide === 'right' ? hipMidY + hipDrop : hipMidY;
  pose[IDX.leftHip] = makeLandmark(cx - hipHalf, leftHipY, visibility);
  pose[IDX.rightHip] = makeLandmark(cx + hipHalf, rightHipY, visibility);

  let wristY: number;
  if (wrists === 'overhead') {
    wristY = shoulderMidY - 0.10;
  } else if (wrists === 'sides') {
    wristY = hipMidY + 0.04;
  } else {
    wristY = (shoulderMidY + hipMidY) / 2 - 0.02;
  }
  const elbowY = (shoulderMidY + wristY) / 2;
  pose[IDX.leftElbow] = makeLandmark(cx - 0.04, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + 0.04, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(wrists === 'sides' ? cx - hipHalf - 0.01 : cx - 0.005, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(wrists === 'sides' ? cx + hipHalf + 0.01 : cx + 0.005, wristY, visibility);

  const standingFootX = liftedSide === 'left' ? (cx - swayX) + 0.06 : (cx - swayX) - 0.06;
  const standingKneeX = standingFootX;
  const liftedAnkleX = standingKneeX + (liftedSide === 'left' ? -liftedAnkleXOffset : liftedAnkleXOffset);

  const liftedHipX = liftedSide === 'left' ? cx - hipHalf : cx + hipHalf;
  const liftedAnkleY = baseAnkleY - liftElevation;
  const liftedKneeX = (liftedHipX + liftedAnkleX) / 2 + (liftedSide === 'left' ? -0.03 : 0.03);
  const liftedHipY = liftedSide === 'left' ? leftHipY : rightHipY;
  const liftedKneeY = kneeLiftOverride !== undefined
    ? (liftedHipY + (baseAnkleY - kneeLiftOverride * 2)) / 2
    : (liftedHipY + liftedAnkleY) / 2;

  const standingAnkleY = baseAnkleY;
  const standingKneeY = (hipMidY + standingAnkleY) / 2;

  if (liftedSide === 'left') {
    pose[IDX.leftKnee] = makeLandmark(liftedKneeX, liftedKneeY, visibility);
    pose[IDX.rightKnee] = makeLandmark(standingKneeX, standingKneeY, visibility);
    pose[IDX.leftAnkle] = makeLandmark(liftedAnkleX, liftedAnkleY, visibility);
    pose[IDX.rightAnkle] = makeLandmark(standingFootX, standingAnkleY, visibility);
  } else {
    pose[IDX.leftKnee] = makeLandmark(standingKneeX, standingKneeY, visibility);
    pose[IDX.rightKnee] = makeLandmark(liftedKneeX, liftedKneeY, visibility);
    pose[IDX.leftAnkle] = makeLandmark(standingFootX, standingAnkleY, visibility);
    pose[IDX.rightAnkle] = makeLandmark(liftedAnkleX, liftedAnkleY, visibility);
  }

  pose[IDX.leftHeel] = makeLandmark(pose[IDX.leftAnkle].x - 0.005, pose[IDX.leftAnkle].y + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(pose[IDX.rightAnkle].x + 0.005, pose[IDX.rightAnkle].y + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(pose[IDX.leftAnkle].x + 0.02, pose[IDX.leftAnkle].y, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(pose[IDX.rightAnkle].x - 0.02, pose[IDX.rightAnkle].y, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// GATE POSE — front-on kneeling lateral side-bend. One leg extended out to the
// side (wide stance); torso tipped sideways (shoulders shifted laterally from
// the hips); the top arm raised above the shoulder. The engine reads only the
// lateral-lean magnitude + the top-arm height, so those are constructed exactly.
// ────────────────────────────────────────────────────────────────────────

export function buildGatePosePose(intent: GatePosePoseIntent = {}): PoseLandmarks {
  const {
    bendSide = 'right',
    leanDeg = 30,
    topArmUp = true,
    legSpread = 0.24,
    swayX = 0,
    swayY = 0,
    shoulderRise = 0,
    shoulderWidthOverride,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + swayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = 0.06;

  // bodyHeight scales the vertical extent (shoulder→ankle span) so tests can
  // drive the body-height distance gate. Default 0.70 → vScale 1 (no change).
  const vScale = bodyHeight / 0.70;
  const hipMidY = baseAnkleY - 0.35 * vScale + swayY;
  const torsoDy = 0.18 * vScale;
  const bendDir = bendSide === 'right' ? 1 : -1;
  const leanRad = (leanDeg * Math.PI) / 180;
  const shoulderShiftX = Math.tan(leanRad) * torsoDy;
  const shoulderMidX = cx + bendDir * shoulderShiftX;
  const shoulderMidY = hipMidY - torsoDy - shoulderRise;
  const headY = shoulderMidY - 0.10;

  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderMidY, visibility);

  pose[IDX.leftHip] = makeLandmark(cx - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(cx + hipHalf, hipMidY, visibility);

  // Arms: the raised (top) arm is on the side OPPOSITE the bend. When topArmUp
  // is false it drops to just below the shoulder (arms-not-overhead).
  const raisedSide: 'left' | 'right' = bendSide === 'right' ? 'left' : 'right';
  const raisedWristY = topArmUp ? shoulderMidY - 0.12 : shoulderMidY + 0.06;
  const raisedWristX = shoulderMidX + bendDir * 0.04;     // arcs over toward the bend
  const bottomWristY = hipMidY + 0.05;                    // bottom hand rests low on the extended leg
  const bottomWristX = cx + bendDir * 0.10;

  const lWristY = raisedSide === 'left' ? raisedWristY : bottomWristY;
  const lWristX = raisedSide === 'left' ? raisedWristX : bottomWristX;
  const rWristY = raisedSide === 'right' ? raisedWristY : bottomWristY;
  const rWristX = raisedSide === 'right' ? raisedWristX : bottomWristX;
  pose[IDX.leftElbow] = makeLandmark((shoulderMidX - shoulderHalf + lWristX) / 2, (shoulderMidY + lWristY) / 2, visibility);
  pose[IDX.rightElbow] = makeLandmark((shoulderMidX + shoulderHalf + rWristX) / 2, (shoulderMidY + rWristY) / 2, visibility);
  pose[IDX.leftWrist] = makeLandmark(lWristX, lWristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rWristX, rWristY, visibility);

  // Legs: extended leg out to the bend side (straight); kneeling leg tucked in.
  const extendedAnkleX = cx + bendDir * legSpread;
  const extendedAnkleY = baseAnkleY - 0.05;
  const extendedKneeX = (cx + bendDir * hipHalf + extendedAnkleX) / 2;
  const extendedKneeY = (hipMidY + extendedAnkleY) / 2;
  const kneelingAnkleX = cx - bendDir * 0.08;
  const kneelingAnkleY = baseAnkleY;
  const kneelingKneeX = cx - bendDir * 0.05;
  const kneelingKneeY = baseAnkleY - 0.03;   // knee near the floor (kneeling)

  const extendedIsRight = bendSide === 'right';
  if (extendedIsRight) {
    pose[IDX.rightKnee] = makeLandmark(extendedKneeX, extendedKneeY, visibility);
    pose[IDX.rightAnkle] = makeLandmark(extendedAnkleX, extendedAnkleY, visibility);
    pose[IDX.leftKnee] = makeLandmark(kneelingKneeX, kneelingKneeY, visibility);
    pose[IDX.leftAnkle] = makeLandmark(kneelingAnkleX, kneelingAnkleY, visibility);
  } else {
    pose[IDX.leftKnee] = makeLandmark(extendedKneeX, extendedKneeY, visibility);
    pose[IDX.leftAnkle] = makeLandmark(extendedAnkleX, extendedAnkleY, visibility);
    pose[IDX.rightKnee] = makeLandmark(kneelingKneeX, kneelingKneeY, visibility);
    pose[IDX.rightAnkle] = makeLandmark(kneelingAnkleX, kneelingAnkleY, visibility);
  }

  pose[IDX.leftHeel] = makeLandmark(pose[IDX.leftAnkle].x - 0.005, pose[IDX.leftAnkle].y + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(pose[IDX.rightAnkle].x + 0.005, pose[IDX.rightAnkle].y + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(pose[IDX.leftAnkle].x + 0.02, pose[IDX.leftAnkle].y, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(pose[IDX.rightAnkle].x - 0.02, pose[IDX.rightAnkle].y, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// WARRIOR II — side-facing lunge stance, two-leg geometry
// ────────────────────────────────────────────────────────────────────────
//
// Each leg's geometry is placed INDEPENDENTLY using the same side-view formula
// (shin vertical from ankle to knee, thigh at angle θ from vertical to hip).
// The engine reads each leg's `kneeFlexionDeg(hip, knee, ankle)` and returns
// the requested θ.
//
// Pelvis isn't strictly rigid in this stub — front and back hips can sit at
// different heights when the legs have different flex (e.g., front knee bent
// 90° → front hip low; back knee straight → back hip high). The engine
// doesn't care about pelvis biomechanics; it only reads angles.
//
// Trunk: shoulder-mid above hip-mid (the midpoint of both hips), at trunkLean
// angle from vertical (forward tilt).

const W2_SHIN = 0.18;
const W2_THIGH = 0.20;
const W2_TRUNK = 0.26;

function w2LegGeometry(
  ankleX: number,
  ankleY: number,
  flexDeg: number,
  forwardSign: -1 | 1,
) {
  // shin vertical (knee above ankle)
  const kneeX = ankleX;
  const kneeY = ankleY - W2_SHIN;
  // Thigh from knee — at angle θ from "shin-direction reversed" (i.e., up).
  // The thigh tilts backward (-forwardSign X direction) as flex grows.
  // Verified: kneeFlexionDeg(hip, knee, ankle) returns θ for this geometry.
  const alpha = (flexDeg * Math.PI) / 180;
  const hipX = kneeX + (-forwardSign) * Math.sin(alpha) * W2_THIGH;
  const hipY = kneeY - Math.cos(alpha) * W2_THIGH;
  return { kneeX, kneeY, hipX, hipY };
}

export function buildWarriorTwoPose(intent: WarriorTwoPoseIntent): PoseLandmarks {
  const {
    frontKneeFlexionDeg,
    backKneeFlexionDeg = 5,
    side = 'left',
    frontLeg = 'right',
    stanceWidth = 0.34,
    trunkLeanDeg = 5,
    shoulderRise = 0,
    bodyHeight = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // forwardSign: user faces +X if side='left' (left side visible to camera).
  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1;

  const cx = 0.50;
  const baseAnkleY = 0.90;
  const halfStance = stanceWidth / 2;

  // Front foot at +forwardSign side; back foot at -forwardSign side.
  const frontAnkleX = cx + forwardSign * halfStance;
  const backAnkleX = cx - forwardSign * halfStance;
  const ankleY = baseAnkleY;

  // Compute front + back leg geometries.
  const frontGeom = w2LegGeometry(frontAnkleX, ankleY, frontKneeFlexionDeg, forwardSign);
  const backGeom = w2LegGeometry(backAnkleX, ankleY, backKneeFlexionDeg, -forwardSign as -1 | 1);
  //   ^^^ back leg uses inverted forwardSign so its "backward" is on the
  //   opposite side (toward the back-foot side from the perspective of the
  //   back leg's frame).

  // Trunk: shoulder mid above hip mid with optional lean.
  const hipMidX = (frontGeom.hipX + backGeom.hipX) / 2;
  const hipMidY = (frontGeom.hipY + backGeom.hipY) / 2;
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderMidX = hipMidX + forwardSign * Math.sin(leanRad) * W2_TRUNK;
  const shoulderMidY = hipMidY - Math.cos(leanRad) * W2_TRUNK - shoulderRise;

  // Map landmarks based on which side is left/right (front/back).
  const leftIsFront = frontLeg === 'left';
  const leftHip = leftIsFront ? frontGeom : backGeom;
  const rightHip = leftIsFront ? backGeom : frontGeom;
  const leftKnee = leftIsFront ? frontGeom : backGeom;
  const rightKnee = leftIsFront ? backGeom : frontGeom;
  const leftAnkleX = leftIsFront ? frontAnkleX : backAnkleX;
  const rightAnkleX = leftIsFront ? backAnkleX : frontAnkleX;

  // Shoulders: each shoulder offset from shoulderMid in X direction.
  const shoulderHalf = 0.06;   // half shoulder-width (small for side-on)

  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(leftHip.hipX, leftHip.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHip.hipX, rightHip.hipY, visibility);
  pose[IDX.leftKnee] = makeLandmark(leftKnee.kneeX, leftKnee.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(rightKnee.kneeX, rightKnee.kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, ankleY, visibility);

  // Head — above shoulder mid.
  const headX = shoulderMidX + forwardSign * 0.02;
  const headY = shoulderMidY - 0.08;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.02, shoulderMidY - 0.05, visibility * 0.6);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.02, shoulderMidY - 0.05, visibility * 0.6);

  // Arms extended laterally — but from side view this is mostly Z-axis. We
  // place wrists at shoulder Y, one slightly forward and one slightly back.
  pose[IDX.leftElbow] = makeLandmark(shoulderMidX - 0.07, shoulderMidY, visibility * 0.8);
  pose[IDX.rightElbow] = makeLandmark(shoulderMidX + 0.07, shoulderMidY, visibility * 0.8);
  pose[IDX.leftWrist] = makeLandmark(shoulderMidX - 0.14, shoulderMidY, visibility * 0.7);
  pose[IDX.rightWrist] = makeLandmark(shoulderMidX + 0.14, shoulderMidY, visibility * 0.7);

  // Feet
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// WARRIOR I — side-on lunge stance with arms reaching overhead
// ────────────────────────────────────────────────────────────────────────
//
// Identical lower-body geometry to Warrior II (front leg bent, back leg
// straight, auto-detected by larger knee flex). The ONLY difference is the
// arms: instead of lateral at shoulder height, both wrists reach straight
// overhead (above the shoulders) when armsRaised=true, or drop to hip level
// when false.
export function buildWarriorOnePose(intent: WarriorOnePoseIntent): PoseLandmarks {
  const {
    frontKneeFlexionDeg,
    backKneeFlexionDeg = 5,
    side = 'left',
    frontLeg = 'right',
    stanceWidth = 0.34,
    trunkLeanDeg = 5,
    armsRaised = true,
    shoulderRise = 0,
    bodyHeight = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1;

  const cx = 0.50;
  const baseAnkleY = 0.90;
  const halfStance = stanceWidth / 2;

  const frontAnkleX = cx + forwardSign * halfStance;
  const backAnkleX = cx - forwardSign * halfStance;
  const ankleY = baseAnkleY;

  const frontGeom = w2LegGeometry(frontAnkleX, ankleY, frontKneeFlexionDeg, forwardSign);
  const backGeom = w2LegGeometry(backAnkleX, ankleY, backKneeFlexionDeg, -forwardSign as -1 | 1);

  const hipMidX = (frontGeom.hipX + backGeom.hipX) / 2;
  const hipMidY = (frontGeom.hipY + backGeom.hipY) / 2;
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderMidX = hipMidX + forwardSign * Math.sin(leanRad) * W2_TRUNK;
  const shoulderMidY = hipMidY - Math.cos(leanRad) * W2_TRUNK - shoulderRise;

  const leftIsFront = frontLeg === 'left';
  const leftHip = leftIsFront ? frontGeom : backGeom;
  const rightHip = leftIsFront ? backGeom : frontGeom;
  const leftKnee = leftIsFront ? frontGeom : backGeom;
  const rightKnee = leftIsFront ? backGeom : frontGeom;
  const leftAnkleX = leftIsFront ? frontAnkleX : backAnkleX;
  const rightAnkleX = leftIsFront ? backAnkleX : frontAnkleX;

  const shoulderHalf = 0.06;
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(leftHip.hipX, leftHip.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHip.hipX, rightHip.hipY, visibility);
  pose[IDX.leftKnee] = makeLandmark(leftKnee.kneeX, leftKnee.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(rightKnee.kneeX, rightKnee.kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, ankleY, visibility);

  // Head — above shoulder mid.
  const headX = shoulderMidX + forwardSign * 0.02;
  const headY = shoulderMidY - 0.08;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.02, shoulderMidY - 0.05, visibility * 0.6);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.02, shoulderMidY - 0.05, visibility * 0.6);

  // Arms — overhead (default) or dropped to hip level. When overhead, wrists go
  // clearly above the shoulders (cal/runtime require wrist.y < shoulder.y − 0.05).
  const wristY = armsRaised ? shoulderMidY - 0.14 : hipMidY + 0.04;
  const elbowY = armsRaised ? shoulderMidY - 0.06 : (shoulderMidY + hipMidY) / 2;
  pose[IDX.leftElbow] = makeLandmark(shoulderMidX - 0.03, elbowY, visibility * 0.8);
  pose[IDX.rightElbow] = makeLandmark(shoulderMidX + 0.03, elbowY, visibility * 0.8);
  pose[IDX.leftWrist] = makeLandmark(shoulderMidX - 0.02, wristY, visibility * 0.8);
  pose[IDX.rightWrist] = makeLandmark(shoulderMidX + 0.02, wristY, visibility * 0.8);

  // Feet
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// WARRIOR III — side-on "airplane T". Body faces +X: torso + arms reach
// forward (+X), the lifted leg reaches back (−X). The standing leg drops
// vertically to the floor; the lifted leg extends back toward horizontal.
// ────────────────────────────────────────────────────────────────────────
export function buildWarrior3Pose(intent: Warrior3PoseIntent = {}): PoseLandmarks {
  const {
    torsoPitchFromHorizontalDeg = 10,
    backLegAngleFromHorizontalDeg = 10,
    standingKneeFlexionDeg = 5,
    liftedSide = 'left',
    shoulderRise = 0,
    torsoLen = 0.18,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const hipY = 0.55;
  const floorY = 0.90;
  const standLen = floorY - hipY;     // standing hip → ankle vertical distance
  const liftLen = 0.35;               // lifted leg length

  // Hips at the pelvis pivot (tiny side-on X separation).
  const hipMidX = cx;
  const leftHipX = cx - 0.01;
  const rightHipX = cx + 0.01;

  // Torso reaches forward (+X) at the given pitch from horizontal.
  const pitchRad = (torsoPitchFromHorizontalDeg * Math.PI) / 180;
  const shoulderMidX = cx + torsoLen * Math.cos(pitchRad);
  const shoulderMidY = hipY - torsoLen * Math.sin(pitchRad) - shoulderRise;

  // Standing leg (vertical). Knee offset forward by (D/2)·tan(θ/2) to hit the
  // target hip-knee-ankle flex.
  const halfFlexRad = (standingKneeFlexionDeg / 2) * Math.PI / 180;
  const standKneeX = cx + (standLen / 2) * Math.tan(halfFlexRad);
  const standKneeY = hipY + standLen / 2;
  const standAnkleX = cx;
  const standAnkleY = floorY;

  // Lifted leg reaches back (−X) toward horizontal.
  const blRad = (backLegAngleFromHorizontalDeg * Math.PI) / 180;
  const liftAnkleX = cx - liftLen * Math.cos(blRad);
  const liftAnkleY = hipY + liftLen * Math.sin(blRad);
  const liftKneeX = cx - (liftLen / 2) * Math.cos(blRad);
  const liftKneeY = hipY + (liftLen / 2) * Math.sin(blRad);

  const leftIsLifted = liftedSide === 'left';

  // Assign per-side leg landmarks.
  pose[IDX.leftHip] = makeLandmark(leftHipX, hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, hipY, visibility);
  pose[IDX.leftKnee] = makeLandmark(leftIsLifted ? liftKneeX : standKneeX, leftIsLifted ? liftKneeY : standKneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(leftIsLifted ? standKneeX : liftKneeX, leftIsLifted ? standKneeY : liftKneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftIsLifted ? liftAnkleX : standAnkleX, leftIsLifted ? liftAnkleY : standAnkleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(leftIsLifted ? standAnkleX : liftAnkleX, leftIsLifted ? standAnkleY : liftAnkleY, visibility);

  // Shoulders around the shoulder mid (tiny side-on X separation).
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - 0.01, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + 0.01, shoulderMidY, visibility);

  // Head — forward of the shoulders (reaching +X).
  const headX = shoulderMidX + 0.03;
  const headY = shoulderMidY - 0.01;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX + 0.01, shoulderMidY - 0.02, visibility * 0.6);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.01, shoulderMidY - 0.02, visibility * 0.6);

  // Arms reach forward (+X) from the shoulders.
  pose[IDX.leftElbow] = makeLandmark(shoulderMidX + 0.05, shoulderMidY + 0.01, visibility * 0.8);
  pose[IDX.rightElbow] = makeLandmark(shoulderMidX + 0.05, shoulderMidY + 0.01, visibility * 0.8);
  pose[IDX.leftWrist] = makeLandmark(shoulderMidX + 0.11, shoulderMidY + 0.02, visibility * 0.8);
  pose[IDX.rightWrist] = makeLandmark(shoulderMidX + 0.11, shoulderMidY + 0.02, visibility * 0.8);

  // Feet
  pose[IDX.leftHeel] = makeLandmark((leftIsLifted ? liftAnkleX : standAnkleX) - 0.01, (leftIsLifted ? liftAnkleY : standAnkleY) + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark((leftIsLifted ? standAnkleX : liftAnkleX) - 0.01, (leftIsLifted ? standAnkleY : liftAnkleY) + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark((leftIsLifted ? liftAnkleX : standAnkleX) + 0.02, (leftIsLifted ? liftAnkleY : standAnkleY), visibility);
  pose[IDX.rightFootIndex] = makeLandmark((leftIsLifted ? standAnkleX : liftAnkleX) + 0.02, (leftIsLifted ? standAnkleY : liftAnkleY), visibility);

  void hipMidX;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// SIDE PLANK — chest faces the camera. The body is an elongated line across
// the frame (shoulder-mid left, ankle-mid right); L/R landmarks stack
// vertically around each midpoint (the side-lying stack). hipDelta offsets the
// hip-mid Y from the shoulder→ankle line (> 0 sag, < 0 pike).
// ────────────────────────────────────────────────────────────────────────
export function buildSidePlankPose(intent: SidePlankPoseIntent = {}): PoseLandmarks {
  const {
    hipDelta = 0,
    shoulderRise = 0,
    bodyLengthX = 0.60,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseY = 0.55;
  const half = bodyLengthX / 2;
  const sep = 0.04;   // vertical stack separation between the up/down sides

  const shoulderMidX = cx - half;
  const shoulderMidY = baseY - shoulderRise;
  const hipMidX = cx;
  const hipMidY = baseY + hipDelta;
  const ankleMidX = cx + half;
  const ankleMidY = baseY;
  const kneeMidX = (hipMidX + ankleMidX) / 2;
  const kneeMidY = (hipMidY + ankleMidY) / 2;

  // Shoulders (stacked vertically around the shoulder mid).
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX, shoulderMidY - sep, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX, shoulderMidY + sep, visibility);
  // Hips
  pose[IDX.leftHip] = makeLandmark(hipMidX, hipMidY - sep, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX, hipMidY + sep, visibility);
  // Knees
  pose[IDX.leftKnee] = makeLandmark(kneeMidX, kneeMidY - sep, visibility);
  pose[IDX.rightKnee] = makeLandmark(kneeMidX, kneeMidY + sep, visibility);
  // Ankles
  pose[IDX.leftAnkle] = makeLandmark(ankleMidX, ankleMidY - sep, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleMidX, ankleMidY + sep, visibility);

  // Head — beyond the shoulders along the body line (head end).
  const headX = shoulderMidX - 0.05;
  const headY = shoulderMidY;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.rightEye] = makeLandmark(headX, headY + 0.01, visibility * 0.7);
  pose[IDX.leftEar] = makeLandmark(headX + 0.01, headY - 0.01, visibility * 0.6);
  pose[IDX.rightEar] = makeLandmark(headX + 0.01, headY + 0.01, visibility * 0.6);

  // Support forearm (down) + top arm (up) from the shoulder girdle.
  pose[IDX.leftElbow] = makeLandmark(shoulderMidX, shoulderMidY - 0.10, visibility * 0.8);   // top arm up
  pose[IDX.rightElbow] = makeLandmark(shoulderMidX, shoulderMidY + 0.10, visibility * 0.8);  // support down
  pose[IDX.leftWrist] = makeLandmark(shoulderMidX, shoulderMidY - 0.18, visibility * 0.8);
  pose[IDX.rightWrist] = makeLandmark(shoulderMidX, shoulderMidY + 0.16, visibility * 0.8);

  // Feet
  pose[IDX.leftHeel] = makeLandmark(ankleMidX + 0.01, ankleMidY - sep, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleMidX + 0.01, ankleMidY + sep, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleMidX + 0.03, ankleMidY - sep, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleMidX + 0.03, ankleMidY + sep, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// BOAT POSE — side-on seated "V". The hip (sit bone) is the vertex; the torso
// reaches up-and-back (−X) at torsoAngleDeg from horizontal, the legs reach
// up-and-forward (+X) at legAngleDeg. L/R landmarks sit on each midpoint (tiny
// depth separation), since the engine reads midpoints.
// ────────────────────────────────────────────────────────────────────────
export function buildBoatPosePose(intent: BoatPosePoseIntent = {}): PoseLandmarks {
  const {
    torsoAngleDeg = 45,
    legAngleDeg = 40,
    torsoLen = 0.18,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const hipY = 0.62;
  const legLen = 0.35;
  const sep = 0.01;

  const torsoRad = (torsoAngleDeg * Math.PI) / 180;
  const legRad = (legAngleDeg * Math.PI) / 180;

  const shoulderMidX = cx - torsoLen * Math.cos(torsoRad);
  const shoulderMidY = hipY - torsoLen * Math.sin(torsoRad);
  const ankleMidX = cx + legLen * Math.cos(legRad);
  const ankleMidY = hipY - legLen * Math.sin(legRad);
  const kneeMidX = (cx + ankleMidX) / 2;
  const kneeMidY = (hipY + ankleMidY) / 2;

  // Shoulders / hips / knees / ankles — L/R around each midpoint.
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX, shoulderMidY - sep, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX, shoulderMidY + sep, visibility);
  pose[IDX.leftHip] = makeLandmark(cx, hipY - sep, visibility);
  pose[IDX.rightHip] = makeLandmark(cx, hipY + sep, visibility);
  pose[IDX.leftKnee] = makeLandmark(kneeMidX, kneeMidY - sep, visibility);
  pose[IDX.rightKnee] = makeLandmark(kneeMidX, kneeMidY + sep, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleMidX, ankleMidY - sep, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleMidX, ankleMidY + sep, visibility);

  // Head — beyond the shoulders along the torso line (up-and-back).
  const headX = shoulderMidX - 0.04;
  const headY = shoulderMidY - 0.04;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.7);
  pose[IDX.rightEye] = makeLandmark(headX, headY + 0.01, visibility * 0.7);
  pose[IDX.leftEar] = makeLandmark(headX + 0.01, headY - 0.01, visibility * 0.6);
  pose[IDX.rightEar] = makeLandmark(headX + 0.01, headY + 0.01, visibility * 0.6);

  // Arms reach forward (+X), parallel to the legs.
  const elbowX = cx + 0.10, elbowY = (hipY + kneeMidY) / 2;
  const wristX = cx + 0.20, wristY = (hipY + ankleMidY) / 2;
  pose[IDX.leftElbow] = makeLandmark(elbowX, elbowY - sep, visibility * 0.8);
  pose[IDX.rightElbow] = makeLandmark(elbowX, elbowY + sep, visibility * 0.8);
  pose[IDX.leftWrist] = makeLandmark(wristX, wristY - sep, visibility * 0.8);
  pose[IDX.rightWrist] = makeLandmark(wristX, wristY + sep, visibility * 0.8);

  // Feet
  pose[IDX.leftHeel] = makeLandmark(ankleMidX - 0.01, ankleMidY - sep, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleMidX - 0.01, ankleMidY + sep, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleMidX + 0.02, ankleMidY - sep, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleMidX + 0.02, ankleMidY + sep, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// MOUNTAIN POSE — front-facing upright standing pose
// ────────────────────────────────────────────────────────────────────────
//
// Defaults yield clean Tadasana: shoulders and hips perfectly level, spine
// vertical, feet close together, arms relaxed at sides. Controls let tests
// inject misalignment (shoulderTilt / hipTilt / spineOffsetX), sway, and
// shoulder-rise (for hold-broken).

export function buildMountainPosePose(intent: MountainPosePoseIntent = {}): PoseLandmarks {
  const {
    shoulderTilt = 0,
    hipTilt = 0,
    spineOffsetX = 0,
    swayX = 0,
    swayY = 0,
    shoulderRise = 0,
    ankleXDistance = 0.06,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    // 2026-05-28 round 19: Tadasana variant now requires arms OVERHEAD.
    // Default flipped to true (was false) — old tests that rely on the
    // pre-Round-19 "stand still arms at sides" must set this false.
    // Round 20 dropped the heels-lifted layer entirely.
    armsRaised = true,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + swayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = 0.06;

  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40 + swayY;
  const shoulderMidX = cx + spineOffsetX;
  const shoulderMidY = hipMidY - 0.18 - shoulderRise;
  const headY = shoulderMidY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders — shoulderTilt makes the right shoulder lower (Y +tilt).
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderMidY + shoulderTilt, visibility);

  // Hips — hipTilt makes the right hip lower (Y +tilt).
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY + hipTilt, visibility);

  // Arms — overhead (default) or at sides per intent.
  // 2026-05-28 round 19: when armsRaised=true, wrists go clearly above shoulders
  // (cal requires wrist.y < shoulder.y − 0.05). When false, wrists at hip Y
  // (cal gate fails — runtime fires arms-not-overhead).
  const wristY = armsRaised ? shoulderMidY - 0.10 : hipMidY + 0.04;
  pose[IDX.leftElbow] = makeLandmark(shoulderMidX - hipHalf - 0.02, (shoulderMidY + hipMidY) / 2, visibility);
  pose[IDX.rightElbow] = makeLandmark(shoulderMidX + hipHalf + 0.02, (shoulderMidY + hipMidY) / 2, visibility);
  pose[IDX.leftWrist] = makeLandmark(shoulderMidX - hipHalf - 0.01, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(shoulderMidX + hipHalf + 0.01, wristY, visibility);

  // Legs — both feet planted close together (controlled by ankleXDistance).
  const halfAnkle = ankleXDistance / 2;
  const ankleXLeft = (cx - swayX) - halfAnkle;
  const ankleXRight = (cx - swayX) + halfAnkle;
  const ankleY = baseAnkleY;
  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  // Heel + foot-index sit BELOW the ankle (feet flat on the floor).
  // Round 20: heels-lifted geometry rolled back — no calf raise variant.
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// CALF RAISE — front-facing standing pose. Heels rise together; the signal
// is per-side ankle-Y displacement as % of shoulder width.
// ────────────────────────────────────────────────────────────────────────
//
// Geometry: bicep-curl-style standing skeleton with each ankle's Y shifted
// UPWARD (smaller Y in MediaPipe normalized coords) by
// `riseDelta = heelRisePct / 100 × shoulderWidth`. The whole body above the
// ankles shifts upward by the AVERAGE of left + right rises (rigid-body
// translation of the torso). Foot index (ball of foot) stays at the original
// ankle Y — it's the pivot that stays on the floor.
//
// 0 = flat-foot baseline. A typical full rise lands around 12–18 % of
// shoulder width (≈ 3–6 cm of heel rise at ~40 cm shoulder span).
export function buildCalfRaisePose(intent: CalfRaisePoseIntent): PoseLandmarks {
  const {
    heelRisePct,
    leftHeelRisePct,
    rightHeelRisePct,
    feetWidthRatio = 1.0,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = (cx - torsoSwayX) - ankleHalf;
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;

  // Per-side heel-rise expressed in normalized Y units.
  const riseLeft = ((leftHeelRisePct ?? heelRisePct) / 100) * shoulderWidth;
  const riseRight = ((rightHeelRisePct ?? heelRisePct) / 100) * shoulderWidth;
  const avgRise = (riseLeft + riseRight) / 2;

  const ankleYLeft = baseAnkleY - riseLeft;
  const ankleYRight = baseAnkleY - riseRight;

  // Upper body translates uniformly by the average rise.
  const hipMidX = cx;
  const hipMidY = (baseAnkleY - 0.40) - avgRise;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms — relaxed at sides (calibration-valid). Elbow directly below shoulder,
  // wrist directly below elbow (mirrors bicep-curl's curlArmGeometry at flex=0).
  const armOffset = 0.005;
  const leftElbowX = leftShoulderX - armOffset;
  const rightElbowX = rightShoulderX + armOffset;
  const elbowY = shoulderMidY + 0.13;
  const wristY = elbowY + 0.13;
  pose[IDX.leftElbow] = makeLandmark(leftElbowX, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightElbowX, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftElbowX, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightElbowX, wristY, visibility);

  // Legs — per-side knee Y tracks the per-side ankle so leg-segment lengths
  // stay consistent in the symmetric case.
  const kneeYLeft = (hipMidY + ankleYLeft) / 2;
  const kneeYRight = (hipMidY + ankleYRight) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeYLeft, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeYRight, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleYLeft, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleYRight, visibility);
  // Heels rise with their ankle. Foot index stays at baseline ankle Y — it's
  // the pivot point on the floor.
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleYLeft + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleYRight + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, baseAnkleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, baseAnkleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// JUMPING JACKS — front-facing standing pose. Arms rise + feet separate
// together. Defaults yield CLOSED (arms at sides, feet together).
// ────────────────────────────────────────────────────────────────────────
//
// Geometry: standing skeleton with two independent dials —
//   armOpennessPct → raises BOTH wrists ABOVE the shoulder line by
//                    (pct / 100) × shoulderWidth (i.e. 100 = one shoulder-width
//                    above). The elbow midpoints linearly interpolate between
//                    the at-sides position and the overhead position.
//   legOpennessPct → separates BOTH ankles outward from body center by
//                    (pct / 200) × shoulderWidth each (so total separation
//                    equals (pct / 100) × shoulderWidth).
//
// Per-side overrides let unilateral / asymmetry tests dial each side
// independently. The hips/knees track the average ankle position so the
// stance widens visibly.
export function buildJumpingJacksPose(intent: JumpingJacksPoseIntent): PoseLandmarks {
  const {
    armOpennessPct,
    legOpennessPct,
    leftArmOpennessPct,
    rightArmOpennessPct,
    leftAnkleOffsetPct,
    rightAnkleOffsetPct,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;

  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms — wrists rise above shoulders by `armOpennessPct/100 × shoulderWidth`.
  // At rest the wrist hangs below the shoulder by ~0.20 (arms-at-sides).
  // The bilateral value is overridden per-side if provided.
  const ARMS_AT_SIDES_DROP = 0.26;     // wrist Y when arms hang at sides (relative to shoulder)
  const leftArmPct = leftArmOpennessPct ?? armOpennessPct;
  const rightArmPct = rightArmOpennessPct ?? armOpennessPct;
  const leftWristY = shoulderMidY + ARMS_AT_SIDES_DROP - (leftArmPct / 100) * shoulderWidth - ARMS_AT_SIDES_DROP * (leftArmPct / 100);
  const rightWristY = shoulderMidY + ARMS_AT_SIDES_DROP - (rightArmPct / 100) * shoulderWidth - ARMS_AT_SIDES_DROP * (rightArmPct / 100);
  // Wrist X — arms swing outward as they go up (jumping-jack arc).
  const leftWristX = leftShoulderX - (leftArmPct / 100) * (shoulderWidth * 0.7);
  const rightWristX = rightShoulderX + (rightArmPct / 100) * (shoulderWidth * 0.7);
  // Elbow midpoints — linearly interpolated between (shoulder ± slight outward offset) and the wrist.
  const leftElbowX = (leftShoulderX + leftWristX) / 2;
  const leftElbowY = (shoulderMidY + leftWristY) / 2;
  const rightElbowX = (rightShoulderX + rightWristX) / 2;
  const rightElbowY = (shoulderMidY + rightWristY) / 2;
  pose[IDX.leftElbow] = makeLandmark(leftElbowX, leftElbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightElbowX, rightElbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftWristX, leftWristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightWristX, rightWristY, visibility);

  // Legs — per-side ankle X offset from body center.
  // Default `legOpennessPct = 30` ⇒ each ankle is 0.024 from center (close together).
  // A full open ⇒ `legOpennessPct = 100` ⇒ each ankle is 0.080 from center.
  const halfOpenness = legOpennessPct / 2;   // each side's % offset
  const leftAnkleOffsetActual = leftAnkleOffsetPct ?? halfOpenness;
  const rightAnkleOffsetActual = rightAnkleOffsetPct ?? halfOpenness;
  const ankleY = baseAnkleY;
  const ankleXLeft = (cx - torsoSwayX) - (leftAnkleOffsetActual / 100) * shoulderWidth;
  const ankleXRight = (cx - torsoSwayX) + (rightAnkleOffsetActual / 100) * shoulderWidth;

  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark((hipMidX - hipHalf + ankleXLeft) / 2, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark((hipMidX + hipHalf + ankleXRight) / 2, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// HIGH KNEES — front-facing standing pose with per-side knee elevation.
// ────────────────────────────────────────────────────────────────────────
//
// Geometry: standing skeleton with per-side knee Y shifted up by
// `(kneeLiftPct / 100) × shoulderWidth`. Ankle on the lifted side rises with
// the knee (foot leaves floor when knee bends past 90°). Hip + shoulder + head
// stay fixed — pelvis doesn't vertically translate during high knees.
//
// Defaults yield BOTH_DOWN (both knees flat-foot baseline = both lifts = 0).
export function buildHighKneesPose(intent: HighKneesPoseIntent): PoseLandmarks {
  const {
    leftKneeLiftPct,
    rightKneeLiftPct,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = shoulderWidth / 2;          // feet hip-width at baseline
  const ankleXLeft = (cx - torsoSwayX) - ankleHalf;
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;

  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Per-side knee lift in normalized Y units.
  const liftLeft = (leftKneeLiftPct / 100) * shoulderWidth;
  const liftRight = (rightKneeLiftPct / 100) * shoulderWidth;

  // Baseline knee Y is halfway between hip and ankle (standing straight).
  const baseKneeY = (hipMidY + baseAnkleY) / 2;
  const kneeYLeft = baseKneeY - liftLeft;
  const kneeYRight = baseKneeY - liftRight;

  // Ankle on the lifted side rises with the knee.
  const ankleYLeft = baseAnkleY - liftLeft;
  const ankleYRight = baseAnkleY - liftRight;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms relaxed at sides (calibration-valid baseline).
  const armOffset = 0.005;
  const leftElbowX = leftShoulderX - armOffset;
  const rightElbowX = rightShoulderX + armOffset;
  const elbowY = shoulderMidY + 0.13;
  const wristYHK = elbowY + 0.13;
  pose[IDX.leftElbow] = makeLandmark(leftElbowX, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightElbowX, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftElbowX, wristYHK, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightElbowX, wristYHK, visibility);

  // Legs — per-side knee + ankle track the per-side lift.
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeYLeft, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeYRight, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleYLeft, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleYRight, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleYLeft + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleYRight + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleYLeft, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleYRight, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// SEATED MARCH — FRONT-camera SEATED pose with per-side knee elevation. At rest
// the knees sit just below the hips (thighs level — the "seated" cal signal);
// per-side knee Y rises with *KneeLiftPct (% of shoulder width), exactly like
// High Knees. Ankles are placed (foot rises with the knee) but the engine does
// NOT gate on them. Knee/hip half-widths scale with shoulderWidth so ratios are
// invariant under the Fix X shoulderWidthOverride.
// ────────────────────────────────────────────────────────────────────────
const SM_TORSO_H = 0.20;       // shoulder→hip vertical span (seated torso)
const SM_KNEE_BELOW_HIP = 0.04; // knee just below hip at rest (thighs level)
const SM_SEAT_TO_FOOT = 0.30;   // hip→ankle vertical span (feet on floor)

export function buildSeatedMarchPose(intent: SeatedMarchPoseIntent): PoseLandmarks {
  const {
    leftKneeLiftPct,
    rightKneeLiftPct,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = shoulderWidth * 0.375;     // 0.06 at default 0.16

  const hipMidY = 0.55;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - SM_TORSO_H;
  const headY = shoulderMidY - 0.10;

  const baseKneeY = hipMidY + SM_KNEE_BELOW_HIP;
  const baseAnkleY = hipMidY + SM_SEAT_TO_FOOT;

  // Per-side knee + ankle lift in normalized Y units.
  const liftLeft = (leftKneeLiftPct / 100) * shoulderWidth;
  const liftRight = (rightKneeLiftPct / 100) * shoulderWidth;
  const kneeYLeft = baseKneeY - liftLeft;
  const kneeYRight = baseKneeY - liftRight;
  const ankleYLeft = baseAnkleY - liftLeft;
  const ankleYRight = baseAnkleY - liftRight;

  const leftX = cx - hipHalf;
  const rightX = cx + hipHalf;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  pose[IDX.leftShoulder] = makeLandmark(shoulderMidX - shoulderHalf, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(shoulderMidX + shoulderHalf, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(leftX, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightX, hipMidY, visibility);

  // Arms resting on the thighs (not gated — placed for completeness).
  pose[IDX.leftElbow] = makeLandmark(shoulderMidX - shoulderHalf - 0.01, shoulderMidY + 0.12, visibility);
  pose[IDX.rightElbow] = makeLandmark(shoulderMidX + shoulderHalf + 0.01, shoulderMidY + 0.12, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftX, hipMidY - 0.01, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightX, hipMidY - 0.01, visibility);

  // Legs — per-side knee + ankle track the per-side lift.
  pose[IDX.leftKnee] = makeLandmark(leftX, kneeYLeft, visibility);
  pose[IDX.rightKnee] = makeLandmark(rightX, kneeYRight, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftX, ankleYLeft, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightX, ankleYRight, visibility);
  pose[IDX.leftHeel] = makeLandmark(leftX - 0.005, ankleYLeft + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightX + 0.005, ankleYRight + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftX + 0.02, ankleYLeft, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightX - 0.02, ankleYRight, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// SEATED FORWARD FOLD — side-facing long-sitting pose. The legs extend forward
// along the floor (hip → knee → ankle horizontal); the torso hinges up/forward
// from the hip by foldAngleDeg. Scaled uniformly about the hip-on-floor anchor
// so |hipX − ankleX| (the leg span) = bodyLengthX (angles + the floor line are
// preserved). Built so the engine reads back the requested foldAngleDeg.
// ────────────────────────────────────────────────────────────────────────
const SFF_TORSO = 0.22; // hip→shoulder length (pre-scale)
const SFF_LEG = 0.40;   // hip→ankle length (pre-scale)

export function buildSeatedForwardFoldPose(intent: SeatedForwardFoldPoseIntent): PoseLandmarks {
  const {
    foldAngleDeg,
    side = 'left',
    bodyLengthX = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();
  const forwardSign: -1 | 1 = side === 'left' ? 1 : -1; // legs extend toward +x for 'left'

  const FLOOR_Y = 0.80;
  const HIP_X = 0.30;
  const fold = (foldAngleDeg * Math.PI) / 180;

  // Pre-scale positions. Hip + legs on the floor; torso hinged from the hip.
  const shoulderX0 = HIP_X + forwardSign * SFF_TORSO * Math.sin(fold);
  const shoulderY0 = FLOOR_Y - SFF_TORSO * Math.cos(fold);
  const ankleX0 = HIP_X + forwardSign * SFF_LEG;
  const ankleY0 = FLOOR_Y;
  const kneeX0 = HIP_X + forwardSign * SFF_LEG * 0.5;
  const kneeY0 = FLOOR_Y;
  const wristX0 = shoulderX0 + forwardSign * 0.12; // reaching toward the feet
  const wristY0 = FLOOR_Y - 0.02;
  const elbowX0 = (shoulderX0 + wristX0) / 2;
  const elbowY0 = (shoulderY0 + wristY0) / 2;

  // Scale about the hip-on-floor anchor so the leg span matches bodyLengthX.
  const scale = bodyLengthX / SFF_LEG;
  const sx = (px: number) => HIP_X + (px - HIP_X) * scale;
  const sy = (py: number) => FLOOR_Y + (py - FLOOR_Y) * scale;

  const Shoulder = { x: sx(shoulderX0), y: sy(shoulderY0) };
  const Ankle = { x: sx(ankleX0), y: sy(ankleY0) };
  const Knee = { x: sx(kneeX0), y: sy(kneeY0) };
  const Wrist = { x: sx(wristX0), y: sy(wristY0) };
  const Elbow = { x: sx(elbowX0), y: sy(elbowY0) };

  const visibleSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hiddenSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visibleHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hiddenHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visibleKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
  const hiddenKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
  const visibleAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hiddenAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visibleElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const visibleWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
  const visibleHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
  const visibleFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;

  pose[visibleSh] = makeLandmark(Shoulder.x, Shoulder.y, visibility);
  pose[visibleHip] = makeLandmark(HIP_X, FLOOR_Y, visibility);
  pose[visibleKnee] = makeLandmark(Knee.x, Knee.y, visibility);
  pose[visibleAnkle] = makeLandmark(Ankle.x, Ankle.y, visibility);
  pose[visibleElbow] = makeLandmark(Elbow.x, Elbow.y, visibility);
  pose[visibleWrist] = makeLandmark(Wrist.x, Wrist.y, visibility);
  pose[visibleHeel] = makeLandmark(Ankle.x + forwardSign * 0.02, Ankle.y, visibility);
  pose[visibleFoot] = makeLandmark(Ankle.x + forwardSign * 0.04, Ankle.y - 0.02, visibility);

  pose[hiddenSh] = makeLandmark(Shoulder.x - 0.005, Shoulder.y + 0.003, visibility * 0.5);
  pose[hiddenHip] = makeLandmark(HIP_X - 0.005, FLOOR_Y + 0.003, visibility * 0.5);
  pose[hiddenKnee] = makeLandmark(Knee.x - 0.005, Knee.y + 0.003, visibility * 0.5);
  pose[hiddenAnkle] = makeLandmark(Ankle.x - 0.005, Ankle.y + 0.003, visibility * 0.5);

  // Head beyond the shoulder along the fold direction.
  const headX = Shoulder.x + forwardSign * 0.03;
  const headY = Shoulder.y + 0.02;
  pose[IDX.nose] = makeLandmark(headX, headY, visibility);
  pose[IDX.leftEar] = makeLandmark(Shoulder.x, Shoulder.y - 0.01, visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(Shoulder.x, Shoulder.y - 0.01, visibility * (side === 'right' ? 1 : 0.5));
  pose[IDX.leftEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);
  pose[IDX.rightEye] = makeLandmark(headX, headY - 0.01, visibility * 0.6);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// SIDE LEG RAISE — FRONT-camera standing pose with per-side hip abduction.
// Each leg rotates OUTWARD from its hip by the abduction angle (frontal plane):
//   ankle = hip + (outwardSign·sin θ, cos θ)·legLen   (knee at mid-leg, straight)
// At θ=0 the ankle sits directly below the hip (standing). The engine's
// legAbductionDeg(hip, ankle) = atan2(|Δx|, Δy) returns exactly θ. hipHalf
// scales with shoulderWidth so feetWidth/shoulderWidth stays constant under
// the Fix X shoulderWidthOverride.
// ────────────────────────────────────────────────────────────────────────
const SLR_LEG_LEN = 0.40; // hip→ankle vertical span (matches hipMidY→ankleY)

export function buildSideLegRaisePose(intent: SideLegRaisePoseIntent): PoseLandmarks {
  const {
    leftAbductionDeg = 0,
    rightAbductionDeg = 0,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  // Hip half-width scales with shoulder width so feetWidth/shoulderWidth (the
  // calibration feetHipWidth ratio) is invariant to shoulderWidthOverride.
  const hipHalf = shoulderWidth * 0.375; // 0.06 at default 0.16

  const hipMidX = cx;
  const hipMidY = baseAnkleY - SLR_LEG_LEN;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  const leftHipX = hipMidX - hipHalf;
  const rightHipX = hipMidX + hipHalf;
  pose[IDX.leftHip] = makeLandmark(leftHipX, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, hipMidY, visibility);

  // Arms relaxed at sides.
  const armOffset = 0.005;
  const elbowY = shoulderMidY + 0.13;
  const wristY = elbowY + 0.13;
  pose[IDX.leftElbow] = makeLandmark(leftShoulderX - armOffset, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightShoulderX + armOffset, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftShoulderX - armOffset, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightShoulderX + armOffset, wristY, visibility);

  // Legs — each rotates outward from its hip by the abduction angle.
  // outwardSign: left leg swings to screen-left (−1), right leg to screen-right (+1).
  const placeLeg = (hipX: number, abdDeg: number, outwardSign: -1 | 1, kneeIdx: number, ankleIdx: number, heelIdx: number, footIdx: number) => {
    const theta = (abdDeg * Math.PI) / 180;
    const ankleX = hipX + outwardSign * Math.sin(theta) * SLR_LEG_LEN;
    const ankleY = hipMidY + Math.cos(theta) * SLR_LEG_LEN;
    const kneeX = hipX + outwardSign * Math.sin(theta) * (SLR_LEG_LEN / 2);
    const kneeY = hipMidY + Math.cos(theta) * (SLR_LEG_LEN / 2);
    pose[kneeIdx] = makeLandmark(kneeX, kneeY, visibility);
    pose[ankleIdx] = makeLandmark(ankleX, ankleY, visibility);
    pose[heelIdx] = makeLandmark(ankleX + outwardSign * -0.005, ankleY + 0.01, visibility);
    pose[footIdx] = makeLandmark(ankleX + outwardSign * 0.02, ankleY, visibility);
  };
  placeLeg(leftHipX, leftAbductionDeg, -1, IDX.leftKnee, IDX.leftAnkle, IDX.leftHeel, IDX.leftFootIndex);
  placeLeg(rightHipX, rightAbductionDeg, 1, IDX.rightKnee, IDX.rightAnkle, IDX.rightHeel, IDX.rightFootIndex);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// OBLIQUE SIDE BEND — FRONT-camera standing pose with the torso bent laterally.
// The torso (hipMid→shoulderMid) rotates by the signed lean angle; legs stay
// vertical with feet under the hips. The engine reads lateralLeanDeg from the
// shoulder/hip midpoints, so placing the shoulders symmetrically about the bent
// shoulderMid is sufficient. hipHalf scales with shoulderWidth so the
// feetWidth/shoulderWidth ratio is invariant to shoulderWidthOverride.
// ────────────────────────────────────────────────────────────────────────
const SBEND_TORSO_LEN = 0.18;
const SBEND_LEG_LEN = 0.40;

export function buildObliqueSideBendPose(intent: ObliqueSideBendPoseIntent): PoseLandmarks {
  const {
    leanDeg = 0,
    forwardFold = 0,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const hipHalf = shoulderWidth * 0.375; // 0.06 at default 0.16

  const hipMidX = cx;
  const hipMidY = baseAnkleY - SBEND_LEG_LEN;

  // Torso bent by the signed lean. + = shoulders shift to screen-right.
  // `forwardFold` adds extra downward shoulder drop (y increases) to simulate a
  // forward fold contaminating the bend — the engine's forward-fold gate must
  // reject reps dominated by it.
  const theta = (Math.abs(leanDeg) * Math.PI) / 180;
  const dir = leanDeg < 0 ? -1 : 1;
  const shoulderMidX = hipMidX + dir * Math.sin(theta) * SBEND_TORSO_LEN;
  const shoulderMidY = hipMidY - Math.cos(theta) * SBEND_TORSO_LEN + forwardFold;
  const headY = shoulderMidY - 0.10;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders symmetric about the (bent) shoulder midpoint; hips level.
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  const leftHipX = hipMidX - hipHalf;
  const rightHipX = hipMidX + hipHalf;
  pose[IDX.leftHip] = makeLandmark(leftHipX, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, hipMidY, visibility);

  // Arms relaxed (not gated). Hang from each shoulder.
  const elbowY = shoulderMidY + 0.13;
  const wristY = elbowY + 0.13;
  pose[IDX.leftElbow] = makeLandmark(leftShoulderX, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightShoulderX, elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftShoulderX, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightShoulderX, wristY, visibility);

  // Legs vertical, feet under the hips.
  const kneeY = hipMidY + SBEND_LEG_LEN / 2;
  pose[IDX.leftKnee] = makeLandmark(leftHipX, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(rightHipX, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftHipX, baseAnkleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightHipX, baseAnkleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(leftHipX - 0.005, baseAnkleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightHipX + 0.005, baseAnkleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftHipX + 0.02, baseAnkleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightHipX - 0.02, baseAnkleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// FRONT RAISE — 2026-05-28 round 21: FRONT-camera standing pose. Mirrors
// LateralRaisePose geometry but with the wrist X projection scaled down by
// `armOutwardFactor` (default 0.10) so wrists stay NEAR the body midline at
// peak flexion (forward arm motion projects to small X displacement in 2D).
// Setting armOutwardFactor to 0.90 simulates the user doing a lateral raise
// by mistake — engine should reject with `arms-out-not-front`.
// ────────────────────────────────────────────────────────────────────────
//
// Y geometry per arm (identical to lateral-raise):
//   wristY = shoulderY + armLen * cos(flex)  → arm vertical at flex=0, horizontal at flex=90
//
// X geometry:
//   wristX = shoulderX + outwardSign * armLen * sin(flex) * armOutwardFactor
//   Lateral raise = armOutwardFactor 1.0 → wrist swings full lateral
//   Front raise   = armOutwardFactor 0.1 → wrist X barely moves
// ────────────────────────────────────────────────────────────────────────
const FR_ARM_LEN = 0.22;

function frArmGeometry(
  shoulderX: number,
  shoulderY: number,
  flexionDeg: number,
  side: 'left' | 'right',
  armOutwardFactor: number,
) {
  const theta = (flexionDeg * Math.PI) / 180;
  const outwardSign = side === 'left' ? -1 : 1;
  const wristX = shoulderX + outwardSign * Math.sin(theta) * FR_ARM_LEN * armOutwardFactor;
  const wristY = shoulderY + Math.cos(theta) * FR_ARM_LEN;
  const elbowX = (shoulderX + wristX) / 2;
  const elbowY = (shoulderY + wristY) / 2;
  return { elbowX, elbowY, wristX, wristY };
}

export function buildFrontRaisePose(intent: FrontRaisePoseIntent): PoseLandmarks {
  const {
    shoulderFlexionDeg,
    leftShoulderFlexionDeg,
    rightShoulderFlexionDeg,
    feetWidthRatio = 1.0,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    armOutwardFactor = 0.25,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = (cx - torsoSwayX) - ankleHalf;
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;
  const ankleY = baseAnkleY;

  // Vertical chain (mirror lateral-raise)
  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms — flexion angle drives Y (vertical raise); X stays near body midline
  // because forward arm motion projects to small X displacement in 2D.
  const leftFlex = leftShoulderFlexionDeg ?? shoulderFlexionDeg;
  const rightFlex = rightShoulderFlexionDeg ?? shoulderFlexionDeg;
  const leftArm = frArmGeometry(leftShoulderX, shoulderMidY, leftFlex, 'left', armOutwardFactor);
  const rightArm = frArmGeometry(rightShoulderX, shoulderMidY, rightFlex, 'right', armOutwardFactor);
  pose[IDX.leftElbow] = makeLandmark(leftArm.elbowX, leftArm.elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX, rightArm.elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftArm.wristX, leftArm.wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightArm.wristX, rightArm.wristY, visibility);

  // Legs (standing straight)
  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// ARM CIRCLES — 2026-05-28 round 21: FRONT-camera standing pose. Bilateral
// shoulder abduction (clone of lateral-raise stub geometry — no plane
// discriminator means full lateral wrist extension is the correct model;
// the engine measures the abduction angle and doesn't gate on wrist-outward
// ratio).
// ────────────────────────────────────────────────────────────────────────
const AC_ARM_LEN = 0.22;

function acArmGeometry(
  shoulderX: number,
  shoulderY: number,
  abductionDeg: number,
  side: 'left' | 'right',
) {
  const theta = (abductionDeg * Math.PI) / 180;
  const outwardSign = side === 'left' ? -1 : 1;
  const wristX = shoulderX + outwardSign * Math.sin(theta) * AC_ARM_LEN;
  const wristY = shoulderY + Math.cos(theta) * AC_ARM_LEN;
  const elbowX = (shoulderX + wristX) / 2;
  const elbowY = (shoulderY + wristY) / 2;
  return { elbowX, elbowY, wristX, wristY };
}

export function buildArmCirclesPose(intent: ArmCirclesPoseIntent): PoseLandmarks {
  const {
    abductionDeg,
    leftAbductionDeg,
    rightAbductionDeg,
    feetWidthRatio = 1.0,
    torsoSwayX = 0,
    bodyHeight = 0.70,
    shoulderWidthOverride,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = shoulderWidthOverride ?? 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = (cx - torsoSwayX) - ankleHalf;
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;
  const ankleY = baseAnkleY;

  // Vertical chain (mirror lateral-raise)
  const hipMidX = cx;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  // Head
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  // Shoulders + hips
  const leftShoulderX = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms — abducted outward from shoulder by the per-arm angle
  const leftAbd = leftAbductionDeg ?? abductionDeg;
  const rightAbd = rightAbductionDeg ?? abductionDeg;
  const leftArm = acArmGeometry(leftShoulderX, shoulderMidY, leftAbd, 'left');
  const rightArm = acArmGeometry(rightShoulderX, shoulderMidY, rightAbd, 'right');
  pose[IDX.leftElbow] = makeLandmark(leftArm.elbowX, leftArm.elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX, rightArm.elbowY, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftArm.wristX, leftArm.wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightArm.wristX, rightArm.wristY, visibility);

  // Legs (standing straight)
  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// TRIANGLE POSE — FRONT-facing wide-stance hold with both legs STRAIGHT,
// top arm reaching straight up to the sky, bottom hand reaching DOWN
// toward the front-foot toe. The trunk hinges laterally toward the front
// foot WITHIN the camera plane (visible as the spine tipping in image X).
// ────────────────────────────────────────────────────────────────────────

const TP_TRUNK = 0.28;
const TP_ARM = 0.20;
const TP_SHOULDER_HALF = 0.10;        // anatomical half shoulder-width
const TP_HIP_HALF = 0.025;            // anatomical half hip-width
const TP_HINGE_DEG = 50;              // default lateral hinge of the trunk

export function buildTrianglePosePose(intent: TrianglePosePoseIntent): PoseLandmarks {
  const {
    frontKneeFlexionDeg = 5,
    backKneeFlexionDeg = 5,
    frontLeg = 'right',
    topArmTiltDeg = 0,
    bottomArmLiftFromAnkle = 0,
    stanceWidth = 0.34,
    shoulderRise = 0,
    bodyHeight = 0.50,
    shoulderWidthOverride,
    armsAtChest = false,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // FRONT view, user facing the camera. MediaPipe labels landmarks per the
  // user's actual body — convention: user's LEFT side at HIGHER X (camera
  // shows mirror image; the user's left appears on the camera's right).
  const cx = 0.50;
  const ankleY = 0.90;
  const halfStance = stanceWidth / 2;
  const leftAnkleX = cx + halfStance;
  const rightAnkleX = cx - halfStance;

  // frontSign: +1 if front foot is the user's LEFT (high X); -1 if right.
  const frontSign: -1 | 1 = frontLeg === 'left' ? 1 : -1;
  const frontAnkleX = frontSign === 1 ? leftAnkleX : rightAnkleX;

  // Hip mid centered between the feet, ankleY − 0.25 (typical leg length).
  const hipMidX = cx;
  const hipMidY = ankleY - 0.25;
  // Hips close together (anatomical hip width, ~0.05 total) — front view.
  const leftHipX = hipMidX + TP_HIP_HALF;
  const rightHipX = hipMidX - TP_HIP_HALF;

  // Per-leg knee position: midpoint of (hip, ankle) plus perpendicular
  // offset for bent variants. For flex θ the perpendicular distance is
  // (L/2) × tan(θ/2). For triangle the bend (if any) goes toward +X for
  // the user's left leg, −X for right leg ("knee buckles forward").
  function kneePos(hipX: number, hipY: number, ankX: number, ankY: number,
                   flexDeg: number, perpSign: -1 | 1) {
    const midX = (hipX + ankX) / 2;
    const midY = (hipY + ankY) / 2;
    if (flexDeg <= 0) return { kneeX: midX, kneeY: midY };
    const L = Math.hypot(hipX - ankX, hipY - ankY);
    const d = (L / 2) * Math.tan((flexDeg * Math.PI) / 180 / 2);
    const dx = ankX - hipX;
    const dy = ankY - hipY;
    const len = Math.hypot(dx, dy) || 1;
    // Rotate (dx, dy) 90° → (-dy, dx). Sign chooses which side the knee
    // buckles to; for triangle synth we always buckle toward the body
    // midline (less visible from front) — perpSign×1 for the user's left
    // leg, perpSign×−1 for the right leg.
    const perpX = (-dy / len) * perpSign;
    const perpY = (dx / len) * perpSign;
    return { kneeX: midX + d * perpX, kneeY: midY + d * perpY };
  }
  const leftFlex = frontLeg === 'left' ? frontKneeFlexionDeg : backKneeFlexionDeg;
  const rightFlex = frontLeg === 'left' ? backKneeFlexionDeg : frontKneeFlexionDeg;
  const leftLeg = kneePos(leftHipX, hipMidY, leftAnkleX, ankleY, leftFlex, -1);
  const rightLeg = kneePos(rightHipX, hipMidY, rightAnkleX, ankleY, rightFlex, 1);

  // Spine: hinged TP_HINGE_DEG toward the front foot (in image X).
  const hingeRad = (TP_HINGE_DEG * Math.PI) / 180;
  const shoulderMidX = hipMidX + frontSign * Math.sin(hingeRad) * TP_TRUNK;
  const shoulderMidY = hipMidY - Math.cos(hingeRad) * TP_TRUNK - shoulderRise;

  // Top arm = the arm OPPOSITE the front leg (classical convention).
  const topArm: 'left' | 'right' = frontLeg === 'left' ? 'right' : 'left';

  // Shoulder line is perpendicular to the (hinged) spine. The BOTTOM
  // shoulder is on the +frontSign side of the spine (toward the front
  // foot); the TOP shoulder is on the −frontSign side.
  // Unit perpendicular pointing toward the BOTTOM shoulder direction:
  //   (frontSign × cos(hinge), sin(hinge)). The TOP shoulder is the mirror.
  const halfWidth = shoulderWidthOverride !== undefined
    ? Math.max(shoulderWidthOverride / 2, 0.02)
    : TP_SHOULDER_HALF;
  const bottomShoulderX = shoulderMidX + frontSign * Math.cos(hingeRad) * halfWidth;
  const bottomShoulderY = shoulderMidY + Math.sin(hingeRad) * halfWidth;
  const topShoulderX = shoulderMidX - frontSign * Math.cos(hingeRad) * halfWidth;
  const topShoulderY = shoulderMidY - Math.sin(hingeRad) * halfWidth;
  const leftShoulderX = topArm === 'left' ? topShoulderX : bottomShoulderX;
  const leftShoulderY = topArm === 'left' ? topShoulderY : bottomShoulderY;
  const rightShoulderX = topArm === 'left' ? bottomShoulderX : topShoulderX;
  const rightShoulderY = topArm === 'left' ? bottomShoulderY : topShoulderY;

  // Top arm: straight UP from top shoulder (with optional tilt). Tilt sign:
  // positive tilt pushes the wrist toward +X.
  const tiltRad = (topArmTiltDeg * Math.PI) / 180;
  const topWristX = topShoulderX + Math.sin(tiltRad) * TP_ARM;
  const topWristY = topShoulderY - Math.cos(tiltRad) * TP_ARM;
  const topElbowX = (topShoulderX + topWristX) / 2;
  const topElbowY = (topShoulderY + topWristY) / 2;

  // Bottom arm: wrist sits at the front-ankle X, Y controlled by lift.
  // For lift = 0 → wrist Y = front-ankle Y (hand at the toe).
  // For lift > 0 → wrist Y is ABOVE the ankle by lift × bodyHeight.
  const bottomWristX = frontAnkleX;
  const bottomWristY = ankleY - bottomArmLiftFromAnkle * bodyHeight;
  const bottomElbowX = (bottomShoulderX + bottomWristX) / 2;
  const bottomElbowY = (bottomShoulderY + bottomWristY) / 2;

  // Optional "arms at chest" negative-cal variant: both wrists at shoulder
  // mid Y (collapse the triangle arms).
  const effTopWristX = armsAtChest ? topShoulderX + 0.04 : topWristX;
  const effTopWristY = armsAtChest ? topShoulderY + 0.02 : topWristY;
  const effTopElbowX = armsAtChest ? (topShoulderX + effTopWristX) / 2 : topElbowX;
  const effTopElbowY = armsAtChest ? (topShoulderY + effTopWristY) / 2 : topElbowY;
  const effBottomWristX = armsAtChest ? bottomShoulderX - 0.04 : bottomWristX;
  const effBottomWristY = armsAtChest ? bottomShoulderY + 0.02 : bottomWristY;
  const effBottomElbowX = armsAtChest ? (bottomShoulderX + effBottomWristX) / 2 : bottomElbowX;
  const effBottomElbowY = armsAtChest ? (bottomShoulderY + effBottomWristY) / 2 : bottomElbowY;

  // Assign landmarks.
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, leftShoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, rightShoulderY, visibility);
  pose[IDX.leftHip] = makeLandmark(leftHipX, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, hipMidY, visibility);
  pose[IDX.leftKnee] = makeLandmark(leftLeg.kneeX, leftLeg.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(rightLeg.kneeX, rightLeg.kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, ankleY, visibility);

  if (topArm === 'left') {
    pose[IDX.leftElbow] = makeLandmark(effTopElbowX, effTopElbowY, visibility);
    pose[IDX.leftWrist] = makeLandmark(effTopWristX, effTopWristY, visibility);
    pose[IDX.rightElbow] = makeLandmark(effBottomElbowX, effBottomElbowY, visibility);
    pose[IDX.rightWrist] = makeLandmark(effBottomWristX, effBottomWristY, visibility);
  } else {
    pose[IDX.rightElbow] = makeLandmark(effTopElbowX, effTopElbowY, visibility);
    pose[IDX.rightWrist] = makeLandmark(effTopWristX, effTopWristY, visibility);
    pose[IDX.leftElbow] = makeLandmark(effBottomElbowX, effBottomElbowY, visibility);
    pose[IDX.leftWrist] = makeLandmark(effBottomWristX, effBottomWristY, visibility);
  }

  // Head — near the top shoulder (gaze toward the top hand).
  pose[IDX.nose] = makeLandmark(topShoulderX, topShoulderY - 0.05, visibility);
  pose[IDX.leftEye] = makeLandmark(topShoulderX + 0.015, topShoulderY - 0.06, visibility);
  pose[IDX.rightEye] = makeLandmark(topShoulderX - 0.015, topShoulderY - 0.06, visibility);
  pose[IDX.leftEar] = makeLandmark(topShoulderX + 0.03, topShoulderY - 0.04, visibility * 0.7);
  pose[IDX.rightEar] = makeLandmark(topShoulderX - 0.03, topShoulderY - 0.04, visibility * 0.7);

  // Feet — short segments.
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.02, ankleY, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ────────────────────────────────────────────────────────────────────────
// GODDESS POSE — front-facing wide-stance squat with cactus arms
// ────────────────────────────────────────────────────────────────────────
//
// Bilateral symmetric pose. Both ankles at ±stanceWidth/2 from frame center.
// Both knees track over ankles (kneeAnkleRatio=1) unless valgus is requested.
// Hips swing toward body center as knees bend (so kneeFlexionDeg(hip, knee,
// ankle) ≈ requested kneeFlexionDeg). Cactus arms: shoulders at shoulderY,
// elbows abducted outward at shoulder height, wrists straight up above
// elbows (palms-forward → forearm vertical).

const GODDESS_SHIN = 0.18;
const GODDESS_THIGH = 0.22;
const GODDESS_TRUNK = 0.28;

export function buildGoddessPosePose(intent: GoddessPosePoseIntent): PoseLandmarks {
  const {
    kneeFlexionDeg,
    stanceWidth = 0.30,
    kneeAnkleRatio = 1.0,
    elbowDropFraction = 0,
    trunkLeanDeg = 0,
    shoulderRise = 0,
    bodyHeight = 0.65,
    shoulderWidthOverride,
    armsAtSides = false,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const halfStance = stanceWidth / 2;
  const ankleY = baseAnkleY;

  // Ankles — wide.
  const leftAnkleX = cx + halfStance;   // user's LEFT visible at higher X
  const rightAnkleX = cx - halfStance;

  // Knees — at the same Y, X depends on kneeAnkleRatio (caving collapses
  // them toward cx).
  const halfKneeDx = (stanceWidth * kneeAnkleRatio) / 2;
  const kneeY = ankleY - GODDESS_SHIN;
  const leftKneeX = cx + halfKneeDx;
  const rightKneeX = cx - halfKneeDx;

  // Hips — thigh extends from each knee toward the body center, at angle
  // kneeFlexionDeg from vertical. cos(0)=1 gives straight leg (hip directly
  // above knee); sin(90)*thigh gives full horizontal thigh.
  // Formula proven against squat's kneeFlexionDeg(hip, knee, ankle) when
  // shin is vertical (ankle directly below knee). With small valgus the
  // shin tilts a bit but the engine still reads ~the intended angle.
  const flexRad = (kneeFlexionDeg * Math.PI) / 180;
  const thighDx = Math.sin(flexRad) * GODDESS_THIGH;
  const thighDy = Math.cos(flexRad) * GODDESS_THIGH;
  // Left leg: hip swings toward -X (toward center). Right leg: toward +X.
  const leftHipX = leftKneeX - thighDx;
  const rightHipX = rightKneeX + thighDx;
  const hipY = kneeY - thighDy;

  // Trunk: shoulderMid above hipMid with optional forward lean (sin(lean) in
  // X — small displacement that the engine reads as trunkLeanDeg).
  const hipMidX = (leftHipX + rightHipX) / 2; // ≈ cx by symmetry
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderMidX = hipMidX + Math.sin(leanRad) * GODDESS_TRUNK;
  const shoulderMidY = hipY - Math.cos(leanRad) * GODDESS_TRUNK - shoulderRise;

  const sw = shoulderWidthOverride !== undefined ? shoulderWidthOverride : 0.16;
  const leftShoulderX = shoulderMidX + sw / 2;
  const rightShoulderX = shoulderMidX - sw / 2;

  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(leftHipX, hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, hipY, visibility);
  pose[IDX.leftKnee] = makeLandmark(leftKneeX, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(rightKneeX, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rightAnkleX, ankleY, visibility);

  // Head.
  pose[IDX.nose] = makeLandmark(shoulderMidX, shoulderMidY - 0.08, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX + 0.02, shoulderMidY - 0.09, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX - 0.02, shoulderMidY - 0.09, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX + 0.04, shoulderMidY - 0.07, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX - 0.04, shoulderMidY - 0.07, visibility);

  // Arms — cactus position (or relaxed at sides if armsAtSides=true).
  if (armsAtSides) {
    pose[IDX.leftElbow] = makeLandmark(leftShoulderX, shoulderMidY + 0.18, visibility);
    pose[IDX.rightElbow] = makeLandmark(rightShoulderX, shoulderMidY + 0.18, visibility);
    pose[IDX.leftWrist] = makeLandmark(leftShoulderX, shoulderMidY + 0.32, visibility);
    pose[IDX.rightWrist] = makeLandmark(rightShoulderX, shoulderMidY + 0.32, visibility);
  } else {
    // Cactus: shoulders abducted ~90° (elbows further outward by ~sw from
    // each shoulder), elbows bent ~90° (forearm goes straight UP, palms
    // forward → wrists at elbowY - sw).
    const elbowY = shoulderMidY + elbowDropFraction * sw;
    const leftElbowX = leftShoulderX + sw;
    const rightElbowX = rightShoulderX - sw;
    pose[IDX.leftElbow] = makeLandmark(leftElbowX, elbowY, visibility);
    pose[IDX.rightElbow] = makeLandmark(rightElbowX, elbowY, visibility);
    pose[IDX.leftWrist] = makeLandmark(leftElbowX, elbowY - sw, visibility);
    pose[IDX.rightWrist] = makeLandmark(rightElbowX, elbowY - sw, visibility);
  }

  // Feet
  pose[IDX.leftHeel] = makeLandmark(leftAnkleX, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(rightAnkleX, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.03, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(rightAnkleX - 0.03, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}
