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
import { IDX, LM_COUNT, type SquatPoseIntent, type PlankPoseIntent, type PushupPoseIntent, type LungePoseIntent, type LateralLungePoseIntent, type TandemStandPoseIntent, type BicepCurlPoseIntent, type SingleLegStandPoseIntent, type StarPosePoseIntent, type ChairPosePoseIntent, type LateralRaisePoseIntent, type TreePosePoseIntent, type StandingFigure4PoseIntent, type GatePosePoseIntent, type CossackSquatPoseIntent, type CatCowPoseIntent, type WarriorTwoPoseIntent, type WarriorOnePoseIntent, type Warrior3PoseIntent, type SidePlankPoseIntent, type BoatPosePoseIntent, type MountainPosePoseIntent, type CalfRaisePoseIntent, type JumpingJacksPoseIntent, type HighKneesPoseIntent, type FrontRaisePoseIntent, type ArmCirclesPoseIntent, type GoddessPosePoseIntent, type TrianglePosePoseIntent, type WallSitPoseIntent, type SideLegRaisePoseIntent, type ObliqueSideBendPoseIntent, type ForwardFoldPoseIntent, type DownwardDogPoseIntent, type CobraPosePoseIntent, type SeatedMarchPoseIntent, type SeatedForwardFoldPoseIntent, type DeadliftPoseIntent, type PullUpPoseIntent, type OverheadPressPoseIntent, type RomanianDeadliftPoseIntent, type BarbellRowPoseIntent, type HammerCurlPoseIntent, type KBSwingPoseIntent, type MountainClimberPoseIntent, type BurpeePoseIntent, type BoxJumpPoseIntent, type StarJumpPoseIntent, type GluteBridgePoseIntent, type OTEPoseIntent, type BroadJumpPoseIntent, type JumpSquatPoseIntent, type ChairDipPoseIntent, type DeadBugPoseIntent, type InchwormPoseIntent, type SupermanPoseIntent, type ShrugPoseIntent, type BirdDogPoseIntent, type StepUpPoseIntent, type WalkingLungePoseIntent, type ReverseFlyPoseIntent, type DonkeyKickPoseIntent, type GobletSquatPoseIntent, type FireHydrantPoseIntent, type CurtsyLungePoseIntent, type PallofPressPoseIntent, type LateralBandWalkPoseIntent } from './types';

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

// ====================================================================
// Strength exercises (ported from Bilal's harness):
//   deadlift, pull-up, overhead press, romanian deadlift, barbell row
// ====================================================================
const DL_TORSO = 0.18;
const DL_UPPER_LEG = 0.22;
const DL_LOWER_LEG = 0.22;

export function buildDeadliftPose(intent: DeadliftPoseIntent): PoseLandmarks {
  const {
    hipHingeDeg: hingeDeg = 0,
    armsAtSides = true,
    roundedBack = false,
    hipYOffset = 0,
    side = 'left',
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const ankleX = 0.50;
  const ankleY = 0.85;
  const kneeX = 0.50;
  const kneeY = ankleY - DL_LOWER_LEG;
  const hipX = 0.50;
  const hipY = kneeY - DL_UPPER_LEG;

  const hingeRad = (hingeDeg * Math.PI) / 180;
  const shoulderX = hipX + DL_TORSO * Math.sin(hingeRad);
  let shoulderY = hipY - DL_TORSO * Math.cos(hingeRad);

  if (roundedBack) {
    shoulderY = hipY + 0.06;
  }

  const actualHipY = hipY + hipYOffset;

  const headX = shoulderX + 0.04;
  const headY = shoulderY - 0.08;

  const wristX = shoulderX - 0.02;
  const wristY = armsAtSides ? hipY + 0.04 : shoulderY - 0.15;
  const elbowX = shoulderX;
  const elbowY = (shoulderY + wristY) / 2;

  const [visSh, hidSh] = side === 'left'
    ? [IDX.leftShoulder, IDX.rightShoulder]
    : [IDX.rightShoulder, IDX.leftShoulder];
  const [visHip, hidHip] = side === 'left'
    ? [IDX.leftHip, IDX.rightHip]
    : [IDX.rightHip, IDX.leftHip];
  const [visKnee, hidKnee] = side === 'left'
    ? [IDX.leftKnee, IDX.rightKnee]
    : [IDX.rightKnee, IDX.leftKnee];
  const [visAnkle, hidAnkle] = side === 'left'
    ? [IDX.leftAnkle, IDX.rightAnkle]
    : [IDX.rightAnkle, IDX.leftAnkle];
  const [visElbow, hidElbow] = side === 'left'
    ? [IDX.leftElbow, IDX.rightElbow]
    : [IDX.rightElbow, IDX.leftElbow];
  const [visWrist, hidWrist] = side === 'left'
    ? [IDX.leftWrist, IDX.rightWrist]
    : [IDX.rightWrist, IDX.leftWrist];

  pose[visSh]    = makeLandmark(shoulderX,      shoulderY,      visibility);
  pose[visHip]   = makeLandmark(hipX,            actualHipY,     visibility);
  pose[visKnee]  = makeLandmark(kneeX,           kneeY,          visibility);
  pose[visAnkle] = makeLandmark(ankleX,          ankleY,         visibility);
  pose[visElbow] = makeLandmark(elbowX,          elbowY,         visibility);
  pose[visWrist] = makeLandmark(wristX,          wristY,         visibility);

  pose[hidSh]    = makeLandmark(shoulderX + 0.01, shoulderY + 0.005, visibility * 0.5);
  pose[hidHip]   = makeLandmark(hipX      + 0.01, actualHipY + 0.005, visibility * 0.5);
  pose[hidKnee]  = makeLandmark(kneeX     + 0.01, kneeY      + 0.005, visibility * 0.5);
  pose[hidAnkle] = makeLandmark(ankleX    + 0.01, ankleY     + 0.005, visibility * 0.5);
  pose[hidElbow] = makeLandmark(elbowX    + 0.01, elbowY     + 0.005, visibility * 0.5);
  pose[hidWrist] = makeLandmark(wristX    + 0.01, wristY     + 0.005, visibility * 0.5);

  pose[IDX.nose]     = makeLandmark(headX,        headY,          visibility);
  pose[IDX.leftEar]  = makeLandmark(headX - 0.03, headY + 0.01,  visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(headX + 0.03, headY + 0.01,  visibility * (side === 'right' ? 1 : 0.5));

  const [visHeel, hidHeel] = side === 'left'
    ? [IDX.leftHeel, IDX.rightHeel]
    : [IDX.rightHeel, IDX.leftHeel];
  const [visFoot, hidFoot] = side === 'left'
    ? [IDX.leftFootIndex, IDX.rightFootIndex]
    : [IDX.rightFootIndex, IDX.leftFootIndex];
  pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
  pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01, visibility * 0.5);
  pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,        visibility);
  pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

const PU_UPPER_ARM = 0.13;
const PU_FOREARM_L = 0.13;
const PU_BAR_Y = 0.08;
const PU_SHOULDER_HALF = 0.08;
const PU_TORSO = 0.20;
const PU_LEG_BASE = 0.30;

function pullUpArmGeometry(wristX: number, barY: number, flexDeg: number, side: 'left' | 'right') {
  const thetaRad = (flexDeg * Math.PI) / 180;
  const elbowX = wristX;
  const elbowY = barY + PU_FOREARM_L;
  const inwardSign = side === 'left' ? 1 : -1;
  const shoulderX = elbowX + inwardSign * PU_UPPER_ARM * Math.sin(thetaRad);
  const shoulderY = elbowY + PU_UPPER_ARM * Math.cos(thetaRad);
  return { elbowX, elbowY, shoulderX, shoulderY };
}

export function buildPullUpPose(intent: PullUpPoseIntent): PoseLandmarks {
  const {
    elbowFlexionDeg,
    leftElbowFlexionDeg,
    rightElbowFlexionDeg,
    shrugAmount = 0,
    hipSwingX = 0,
    wristYOffset = 0,
    bodyHeightScale = 1.0,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const barY = PU_BAR_Y + wristYOffset;
  const leftWristX = 0.50 - PU_SHOULDER_HALF;
  const rightWristX = 0.50 + PU_SHOULDER_HALF;

  pose[IDX.leftWrist] = makeLandmark(leftWristX, barY, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightWristX, barY, visibility);

  const leftFlex = leftElbowFlexionDeg ?? elbowFlexionDeg;
  const rightFlex = rightElbowFlexionDeg ?? elbowFlexionDeg;
  const leftArm = pullUpArmGeometry(leftWristX, barY, leftFlex, 'left');
  const rightArm = pullUpArmGeometry(rightWristX, barY, rightFlex, 'right');

  pose[IDX.leftElbow] = makeLandmark(leftArm.elbowX, leftArm.elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX, rightArm.elbowY, visibility);
  pose[IDX.leftShoulder] = makeLandmark(leftArm.shoulderX, leftArm.shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightArm.shoulderX, rightArm.shoulderY, visibility);

  const shoulderMidX = (leftArm.shoulderX + rightArm.shoulderX) / 2;
  const shoulderMidY = (leftArm.shoulderY + rightArm.shoulderY) / 2;

  const hipMidX = shoulderMidX + hipSwingX;
  const hipMidY = shoulderMidY + PU_TORSO;
  const hipHalf = 0.06;
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  const legLength = PU_LEG_BASE * bodyHeightScale;
  const kneeY = hipMidY + legLength / 2;
  const ankleY = hipMidY + legLength;
  pose[IDX.leftKnee] = makeLandmark(hipMidX - hipHalf * 0.5, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(hipMidX + hipHalf * 0.5, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(hipMidX - hipHalf * 0.3, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(hipMidX + hipHalf * 0.3, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(hipMidX - hipHalf * 0.3 - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(hipMidX + hipHalf * 0.3 + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(hipMidX - hipHalf * 0.3, ankleY + 0.02, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(hipMidX + hipHalf * 0.3, ankleY + 0.02, visibility);

  const earGap = 0.10 - shrugAmount;
  const headY = shoulderMidY - earGap;
  pose[IDX.nose] = makeLandmark(shoulderMidX, headY - 0.03, visibility);
  pose[IDX.leftEye] = makeLandmark(shoulderMidX - 0.02, headY - 0.04, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02, headY - 0.04, visibility);
  pose[IDX.leftEar] = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// OVERHEAD PRESS -- front-facing standing pose
// ------------------------------------------------------------------------

const OHP_UPPER_ARM_L = 0.13;
const OHP_FOREARM_L   = 0.13;

function ohpArmGeometry(
  shoulderX: number,
  shoulderY: number,
  flexDeg: number,
  side: 'left' | 'right',
) {
  const flexRad = (flexDeg * Math.PI) / 180;
  const elbowX = shoulderX;
  const elbowY = shoulderY - OHP_UPPER_ARM_L;
  const sign = side === 'left' ? -1 : 1;
  const wristX = elbowX + sign * OHP_FOREARM_L * Math.sin(flexRad);
  const wristY = elbowY - OHP_FOREARM_L * Math.cos(flexRad);
  return { elbowX, elbowY, wristX, wristY };
}

export function buildOverheadPressPose(intent: OverheadPressPoseIntent): PoseLandmarks {
  const {
    elbowFlexionDeg: bilateralFlex,
    leftElbowFlexionDeg,
    rightElbowFlexionDeg,
    feetWidthRatio = 1.0,
    backArchOffset: archOffset = 0,
    barPathDrift: driftX = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft  = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;
  const ankleY = baseAnkleY;

  const hipMidX = cx + archOffset;
  const hipMidY = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  pose[IDX.nose]     = makeLandmark(shoulderMidX,         headY,        visibility);
  pose[IDX.leftEye]  = makeLandmark(shoulderMidX - 0.02,  headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02,  headY - 0.01, visibility);
  pose[IDX.leftEar]  = makeLandmark(shoulderMidX - 0.035, headY,        visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY,        visibility);

  const leftShoulderX  = shoulderMidX - shoulderHalf + driftX;
  const rightShoulderX = shoulderMidX + shoulderHalf + driftX;
  pose[IDX.leftShoulder]  = makeLandmark(leftShoulderX,  shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip]  = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  const leftFlex  = leftElbowFlexionDeg  ?? bilateralFlex;
  const rightFlex = rightElbowFlexionDeg ?? bilateralFlex;
  const leftArm  = ohpArmGeometry(leftShoulderX,  shoulderMidY, leftFlex,  'left');
  const rightArm = ohpArmGeometry(rightShoulderX, shoulderMidY, rightFlex, 'right');

  pose[IDX.leftElbow]  = makeLandmark(leftArm.elbowX,  leftArm.elbowY,  visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX, rightArm.elbowY, visibility);
  pose[IDX.leftWrist]  = makeLandmark(leftArm.wristX,  leftArm.wristY,  visibility);
  pose[IDX.rightWrist] = makeLandmark(rightArm.wristX, rightArm.wristY, visibility);

  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee]  = makeLandmark(ankleXLeft,  kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle]  = makeLandmark(ankleXLeft,  ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel]   = makeLandmark(ankleXLeft  - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel]  = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(ankleXLeft  + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// ROMANIAN DEADLIFT -- side-facing pose (left side visible by default)
// ------------------------------------------------------------------------
//
// Key RDL difference from conventional DL:
//   - Knees stay at a constant soft bend (~15 degrees) throughout the movement
//   - The knee angle does NOT increase as the hinge deepens (unlike conventional DL)
//   - This is modeled by keeping kneeY relative to ankleY constant
//   - extraKneeBend shifts knee forward/down to simulate squat pattern (excessive knee bend)
//
// Geometry (verified against hipHingeDeg formula):
//   Ankle fixed at bottom. Knee above ankle (constant position).
//   Hip above knee. Torso vector (hip->shoulder) rotates by hinge angle from vertical.
//
// Standing: bodyHeight = |ankle.y - shoulder.y| ~ 0.62 (distanceOk gate passes).

const RDL_TORSO = 0.18;
const RDL_UPPER_LEG = 0.22;
const RDL_LOWER_LEG = 0.22;

export function buildRomanianDeadliftPose(intent: RomanianDeadliftPoseIntent): PoseLandmarks {
  const {
    hipHingeDeg: hingeDeg = 0,
    kneeAngleDeg = 15,
    roundedBack = false,
    extraKneeBend = 0,
    side = 'left',
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  void kneeAngleDeg; // conceptual only; geometry uses explicit positional model

  const pose = emptyPose();

  // Ankle fixed at bottom of frame
  const ankleX = 0.50;
  const ankleY = 0.85;

  // Knee directly above ankle (RDL: knees stay nearly straight)
  const kneeX = 0.50;
  const kneeY = ankleY - RDL_LOWER_LEG;   // 0.63

  // Hip directly above knee
  const hipX = 0.50;
  const hipY = kneeY - RDL_UPPER_LEG;     // 0.41

  // Torso rotated by hinge angle from vertical
  const hingeRad = (hingeDeg * Math.PI) / 180;
  const shoulderX = hipX + RDL_TORSO * Math.sin(hingeRad);
  let shoulderY = hipY - RDL_TORSO * Math.cos(hingeRad);

  // Rounded back: shoulder droops below hip level
  if (roundedBack) {
    shoulderY = hipY + 0.06;
  }

  // Extra knee bend: push knee forward/down to simulate squat pattern
  const extraRad = (extraKneeBend * Math.PI) / 180;
  const actualKneeX = kneeX + RDL_LOWER_LEG * Math.sin(extraRad) * 0.5;
  const actualKneeY = kneeY + RDL_LOWER_LEG * (1 - Math.cos(extraRad)) * 0.5;

  const headX = shoulderX + 0.04;
  const headY = shoulderY - 0.08;

  // Wrist: hanging down at sides (holding bar)
  const wristX = shoulderX - 0.02;
  const wristY = hipY + 0.04;
  const elbowX = shoulderX;
  const elbowY = (shoulderY + wristY) / 2;

  // Side indices
  const [visSh, hidSh] = side === 'left'
    ? [IDX.leftShoulder, IDX.rightShoulder]
    : [IDX.rightShoulder, IDX.leftShoulder];
  const [visHip, hidHip] = side === 'left'
    ? [IDX.leftHip, IDX.rightHip]
    : [IDX.rightHip, IDX.leftHip];
  const [visKnee, hidKnee] = side === 'left'
    ? [IDX.leftKnee, IDX.rightKnee]
    : [IDX.rightKnee, IDX.leftKnee];
  const [visAnkle, hidAnkle] = side === 'left'
    ? [IDX.leftAnkle, IDX.rightAnkle]
    : [IDX.rightAnkle, IDX.leftAnkle];
  const [visElbow, hidElbow] = side === 'left'
    ? [IDX.leftElbow, IDX.rightElbow]
    : [IDX.rightElbow, IDX.leftElbow];
  const [visWrist, hidWrist] = side === 'left'
    ? [IDX.leftWrist, IDX.rightWrist]
    : [IDX.rightWrist, IDX.leftWrist];

  // Visible side (full visibility)
  pose[visSh]    = makeLandmark(shoulderX,       shoulderY,       visibility);
  pose[visHip]   = makeLandmark(hipX,            hipY,            visibility);
  pose[visKnee]  = makeLandmark(actualKneeX,     actualKneeY,     visibility);
  pose[visAnkle] = makeLandmark(ankleX,          ankleY,          visibility);
  pose[visElbow] = makeLandmark(elbowX,          elbowY,          visibility);
  pose[visWrist] = makeLandmark(wristX,          wristY,          visibility);

  // Hidden side (lower visibility)
  pose[hidSh]    = makeLandmark(shoulderX    + 0.01, shoulderY    + 0.005, visibility * 0.5);
  pose[hidHip]   = makeLandmark(hipX         + 0.01, hipY         + 0.005, visibility * 0.5);
  pose[hidKnee]  = makeLandmark(actualKneeX  + 0.01, actualKneeY  + 0.005, visibility * 0.5);
  pose[hidAnkle] = makeLandmark(ankleX       + 0.01, ankleY       + 0.005, visibility * 0.5);
  pose[hidElbow] = makeLandmark(elbowX       + 0.01, elbowY       + 0.005, visibility * 0.5);
  pose[hidWrist] = makeLandmark(wristX       + 0.01, wristY       + 0.005, visibility * 0.5);

  // Head
  pose[IDX.nose]     = makeLandmark(headX,        headY,          visibility);
  pose[IDX.leftEar]  = makeLandmark(headX - 0.03, headY + 0.01,  visibility * (side === 'left'  ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(headX + 0.03, headY + 0.01,  visibility * (side === 'right' ? 1 : 0.5));

  // Heels + toes
  const [visHeel, hidHeel] = side === 'left'
    ? [IDX.leftHeel, IDX.rightHeel]
    : [IDX.rightHeel, IDX.leftHeel];
  const [visFoot, hidFoot] = side === 'left'
    ? [IDX.leftFootIndex, IDX.rightFootIndex]
    : [IDX.rightFootIndex, IDX.leftFootIndex];
  pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01,  visibility);
  pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01,  visibility * 0.5);
  pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,         visibility);
  pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// BARBELL ROW — side-facing bent-over pose
// ------------------------------------------------------------------------
// Segment lengths (normalized, fraction of frame height)
const ROW_LOWER_LEG = 0.22;
const ROW_UPPER_LEG = 0.18;
const ROW_TORSO = 0.22;
const ROW_UPPER_ARM = 0.12;
const ROW_FOREARM = 0.10;

/**
 * Build a side-camera pose for a bent-over barbell/dumbbell row.
 *
 * The body is bent over at hipHingeDeg (default 45°). The camera-side arm's
 * elbow flexion varies from ~5–20° (arms hanging) to ~80–130° (row top).
 *
 * Note on elbowFlexionDeg output:
 *   The elbowFlexionDeg() function from bicep-curl geometry measures the
 *   supplement of the shoulder-elbow-wrist angle (180° - interior angle).
 *   Small value (~5-20°) = arms nearly straight (hanging).
 *   Large value (~80-130°) = elbow driven up (row top).
 */
export function buildRowPose(intent: BarbellRowPoseIntent): PoseLandmarks {
  const {
    elbowFlexionDeg: targetFlex,
    hipHingeDeg: hingeDeg = 45,
    roundedBack = false,
    hipSwayY = 0,
    side = 'left',
    bodyHeight: _bodyHeight = 0.60,
    noise = 0,
    seed = 0,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  void _bodyHeight;

  const pose = emptyPose();

  // Ankle fixed
  const ankleX = 0.50;
  const ankleY = 0.85;

  // Knee above ankle
  const kneeX = 0.50;
  const kneeY = ankleY - ROW_LOWER_LEG;

  // Hip above knee, plus sway
  const hipX = 0.50;
  const hipY = kneeY - ROW_UPPER_LEG + hipSwayY;

  // Torso rotated forward by hinge angle
  const hingeRad = (hingeDeg * Math.PI) / 180;
  const shoulderX = hipX + ROW_TORSO * Math.sin(hingeRad);
  let shoulderY = hipY - ROW_TORSO * Math.cos(hingeRad);

  if (roundedBack) {
    shoulderY = hipY + 0.07;
  }

  const headX = shoulderX + 0.04;
  const headY = shoulderY - 0.07;

  // Camera-side arm: upper arm hangs from shoulder, elbow rises as flex increases
  const upperArmLiftRad = (targetFlex * 0.5 * Math.PI) / 180;
  const elbowX = shoulderX - ROW_UPPER_ARM * Math.sin(upperArmLiftRad) * 0.3;
  const elbowY = shoulderY + ROW_UPPER_ARM * Math.cos(upperArmLiftRad);

  // Forearm: from elbow, angle determined by flex
  const forearmRad = (targetFlex * Math.PI) / 180;
  const wristX = elbowX - ROW_FOREARM * Math.sin(forearmRad);
  const wristY = elbowY + ROW_FOREARM * Math.cos(forearmRad);

  // Side indices
  const [visSh, hidSh] = side === 'left'
    ? [IDX.leftShoulder, IDX.rightShoulder]
    : [IDX.rightShoulder, IDX.leftShoulder];
  const [visHip, hidHip] = side === 'left'
    ? [IDX.leftHip, IDX.rightHip]
    : [IDX.rightHip, IDX.leftHip];
  const [visKnee, hidKnee] = side === 'left'
    ? [IDX.leftKnee, IDX.rightKnee]
    : [IDX.rightKnee, IDX.leftKnee];
  const [visAnkle, hidAnkle] = side === 'left'
    ? [IDX.leftAnkle, IDX.rightAnkle]
    : [IDX.rightAnkle, IDX.leftAnkle];
  const [visElbow, hidElbow] = side === 'left'
    ? [IDX.leftElbow, IDX.rightElbow]
    : [IDX.rightElbow, IDX.leftElbow];
  const [visWrist, hidWrist] = side === 'left'
    ? [IDX.leftWrist, IDX.rightWrist]
    : [IDX.rightWrist, IDX.leftWrist];

  pose[visSh]    = makeLandmark(shoulderX,  shoulderY,  visibility);
  pose[visHip]   = makeLandmark(hipX,       hipY,       visibility);
  pose[visKnee]  = makeLandmark(kneeX,      kneeY,      visibility);
  pose[visAnkle] = makeLandmark(ankleX,     ankleY,     visibility);
  pose[visElbow] = makeLandmark(elbowX,     elbowY,     visibility);
  pose[visWrist] = makeLandmark(wristX,     wristY,     visibility);

  pose[hidSh]    = makeLandmark(shoulderX + 0.01, shoulderY + 0.005, visibility * 0.5);
  pose[hidHip]   = makeLandmark(hipX      + 0.01, hipY      + 0.005, visibility * 0.5);
  pose[hidKnee]  = makeLandmark(kneeX     + 0.01, kneeY     + 0.005, visibility * 0.5);
  pose[hidAnkle] = makeLandmark(ankleX    + 0.01, ankleY    + 0.005, visibility * 0.5);
  pose[hidElbow] = makeLandmark(elbowX    + 0.01, elbowY    + 0.005, visibility * 0.5);
  pose[hidWrist] = makeLandmark(wristX    + 0.01, wristY    + 0.005, visibility * 0.5);

  pose[IDX.nose]     = makeLandmark(headX,        headY,          visibility);
  pose[IDX.leftEar]  = makeLandmark(headX - 0.03, headY + 0.01,  visibility * (side === 'left'  ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(headX + 0.03, headY + 0.01,  visibility * (side === 'right' ? 1 : 0.5));

  const [visRowHeel, hidRowHeel] = side === 'left'
    ? [IDX.leftHeel, IDX.rightHeel]
    : [IDX.rightHeel, IDX.leftHeel];
  const [visRowFoot, hidRowFoot] = side === 'left'
    ? [IDX.leftFootIndex, IDX.rightFootIndex]
    : [IDX.rightFootIndex, IDX.leftFootIndex];
  pose[visRowHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01,  visibility);
  pose[hidRowHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01,  visibility * 0.5);
  pose[visRowFoot] = makeLandmark(ankleX + 0.02, ankleY,         visibility);
  pose[hidRowFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ====================================================================
// New exercise pose builders (ported from kriya-mirror)
// ====================================================================
// ------------------------------------------------------------------------
// CHAIR DIP â€” front-facing standing pose, bilateral elbow flexion.
// Same body layout as buildBicepCurlPose; elbowFlareX spreads elbows outward.
// ------------------------------------------------------------------------

export function buildChairDipPose(intent: ChairDipPoseIntent): PoseLandmarks {
  const {
    elbowFlexionDeg: bilateralFlex,
    leftElbowFlexionDeg,
    rightElbowFlexionDeg,
    feetWidthRatio = 1.0,
    torsoSwayX = 0,
    elbowFlareX = 0,
    bodyHeight = 0.70,
    shoulderDescentY = 0,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const leftFlex = leftElbowFlexionDeg ?? bilateralFlex;
  const rightFlex = rightElbowFlexionDeg ?? bilateralFlex;

  const pose = emptyPose();

  // Body layout (same as buildBicepCurlPose)
  const bodyTopY = (1 - bodyHeight) / 2;
  const headY = bodyTopY;
  // shoulderDescentY shifts shoulder (and all landmarks below it) downward
  // to simulate the torso lowering during a real chair dip.
  const shoulderY = headY + bodyHeight * 0.12 + shoulderDescentY;
  const hipY = shoulderY + bodyHeight * 0.50;
  const kneeY = hipY + bodyHeight * 0.22;
  const ankleY = hipY + bodyHeight * 0.48;

  const centerX = 0.5 + torsoSwayX;
  const shoulderHalfW = 0.10;
  const lsX = centerX - shoulderHalfW;
  const rsX = centerX + shoulderHalfW;

  const feetHalfW = shoulderHalfW * feetWidthRatio;
  const laX = centerX - feetHalfW;
  const raX = centerX + feetHalfW;

  const mk = (x: number, y: number) => ({ x, y, z: 0, visibility });

  // Head
  pose[IDX.nose] = mk(centerX, headY);
  pose[IDX.leftEar] = mk(lsX - 0.03, headY + 0.02);
  pose[IDX.rightEar] = mk(rsX + 0.03, headY + 0.02);

  // Shoulders
  pose[IDX.leftShoulder] = mk(lsX, shoulderY);
  pose[IDX.rightShoulder] = mk(rsX, shoulderY);

  // Hips
  pose[IDX.leftHip] = mk(centerX - 0.07, hipY);
  pose[IDX.rightHip] = mk(centerX + 0.07, hipY);

  // Knees / ankles
  pose[IDX.leftKnee] = mk(laX, kneeY);
  pose[IDX.rightKnee] = mk(raX, kneeY);
  pose[IDX.leftAnkle] = mk(laX, ankleY);
  pose[IDX.rightAnkle] = mk(raX, ankleY);
  pose[IDX.leftHeel] = mk(laX - 0.01, ankleY + 0.01);
  pose[IDX.rightHeel] = mk(raX + 0.01, ankleY + 0.01);
  pose[IDX.leftFootIndex] = mk(laX + 0.01, ankleY + 0.02);
  pose[IDX.rightFootIndex] = mk(raX - 0.01, ankleY + 0.02);

  // Arms â€” elbow flexion geometry (same isoceles triangle approach as buildBicepCurlPose)
  const upperArmLen = bodyHeight * 0.18;
  const foreArmLen = bodyHeight * 0.16;

  function dipArmGeometry(shoulderX: number, flexDeg: number, sign: -1 | 1, flareX: number) {
    const flexRad = (flexDeg * Math.PI) / 180;
    // Elbow hangs below shoulder
    const elbowX = shoulderX + sign * flareX;
    const elbowY = shoulderY + upperArmLen;
    // Forearm: at flexDeg, swings sign-ward and downward from the elbow.
    // wristY = elbowY + cos: arm straight down at 0Â°, horizontal at 90Â°.
    const wristX = elbowX + sign * foreArmLen * Math.sin(flexRad);
    const wristY = elbowY + foreArmLen * Math.cos(flexRad);
    return { elbowX, elbowY, wristX, wristY };
  }

  const left = dipArmGeometry(lsX, leftFlex, -1, elbowFlareX);
  const right = dipArmGeometry(rsX, rightFlex, 1, elbowFlareX);

  pose[IDX.leftElbow] = mk(left.elbowX, left.elbowY);
  pose[IDX.rightElbow] = mk(right.elbowX, right.elbowY);
  pose[IDX.leftWrist] = mk(left.wristX, left.wristY);
  pose[IDX.rightWrist] = mk(right.wristX, right.wristY);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// HAMMER CURL â€” identical geometry to BICEP CURL from front camera.
// Neutral grip (thumbs up) looks the same as supinated grip in 2D.
// ------------------------------------------------------------------------

export function buildHammerCurlPose(intent: HammerCurlPoseIntent): PoseLandmarks {
  return buildBicepCurlPose(intent as BicepCurlPoseIntent);
}
export function buildMountainClimberPose(intent: MountainClimberPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    // Invisible pose (occlusion / position-lost)
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }
  const {
    kneeHipAngleDeg: targetAngle,
    hipDeviation = 0,
    side = 'left',
    bodyLength = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Plank geometry: horizontal body
  // shoulder at left side, ankle at right side (for left-facing)
  const shoulderX = 0.15;
  const ankleX = shoulderX + bodyLength;
  const hipX = (shoulderX + ankleX) / 2;
  const baseY = 0.50;  // plank Y level

  const shoulderY = baseY;
  const ankleY = baseY;
  // Hip: at midpoint Y with optional deviation
  const hipY = baseY + hipDeviation;

  // Wrist: directly below shoulder (plank hands position)
  const wristX = shoulderX;
  const wristY = baseY + 0.12;
  // Elbow: between shoulder and wrist
  const elbowX = shoulderX;
  const elbowY = baseY + 0.06;

  // Driving knee position based on target angle:
  // The shoulderâ†’hipâ†’knee angle is measured at the hip vertex.
  // Vector hipâ†’shoulder = (shoulderX - hipX, shoulderY - hipY).
  // We place the knee at unit distance from hip, at angle `targetAngle`
  // from the hipâ†’shoulder direction.
  const hipToShoulderX = shoulderX - hipX;
  const hipToShoulderY = shoulderY - hipY;
  const hipToShoulderLen = Math.sqrt(hipToShoulderX * hipToShoulderX + hipToShoulderY * hipToShoulderY);
  // Normalize
  const ushX = hipToShoulderLen > 0 ? hipToShoulderX / hipToShoulderLen : -1;
  const ushY = hipToShoulderLen > 0 ? hipToShoulderY / hipToShoulderLen : 0;

  // Rotate by -targetAngle (negative = toward ankle side = plank rest position)
  // At 170Â°: knee is on the opposite side from shoulder (behind hip = toward ankle)
  // At 50Â°:  knee is near shoulder direction (forward = toward chest)
  const angleRad = (targetAngle * Math.PI) / 180;
  // Use rotation formula: rotate the hipâ†’shoulder unit vector by angleRad
  const kneeDirX = ushX * Math.cos(angleRad) + ushY * Math.sin(angleRad);
  const kneeDirY = -ushX * Math.sin(angleRad) + ushY * Math.cos(angleRad);

  const kneeLimbLen = 0.20; // approx upper-leg length in normalized coords
  const kneeX = hipX + kneeDirX * kneeLimbLen;
  const kneeY = hipY + kneeDirY * kneeLimbLen;

  // Side indices
  const visSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
  const hidSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
  const hidHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
  const visAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
  const hidAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
  const visElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
  const hidElbow = side === 'left' ? IDX.rightElbow : IDX.leftElbow;
  const visWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
  const hidWrist = side === 'left' ? IDX.rightWrist : IDX.leftWrist;
  const visKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
  const hidKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;

  pose[visSh]    = makeLandmark(shoulderX,         shoulderY,         visibility);
  pose[visHip]   = makeLandmark(hipX,              hipY,              visibility);
  pose[visAnkle] = makeLandmark(ankleX,            ankleY,            visibility);
  pose[visElbow] = makeLandmark(elbowX,            elbowY,            visibility);
  pose[visWrist] = makeLandmark(wristX,            wristY,            visibility);
  pose[visKnee]  = makeLandmark(kneeX,             kneeY,             visibility);

  pose[hidSh]    = makeLandmark(shoulderX + 0.005, shoulderY + 0.005, visibility * 0.5);
  pose[hidHip]   = makeLandmark(hipX      + 0.005, hipY      + 0.005, visibility * 0.5);
  pose[hidAnkle] = makeLandmark(ankleX    - 0.005, ankleY    + 0.005, visibility * 0.5);
  pose[hidElbow] = makeLandmark(elbowX    + 0.005, elbowY    + 0.005, visibility * 0.5);
  pose[hidWrist] = makeLandmark(wristX    + 0.005, wristY    + 0.005, visibility * 0.5);
  pose[hidKnee]  = makeLandmark(kneeX     + 0.005, kneeY     + 0.005, visibility * 0.5);

  // Head / nose above shoulder (side-on)
  pose[IDX.nose]     = makeLandmark(shoulderX - 0.05, shoulderY - 0.03, visibility);
  pose[IDX.leftEar]  = makeLandmark(shoulderX - 0.04, shoulderY - 0.02, visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(shoulderX - 0.04, shoulderY - 0.02, visibility * (side === 'right' ? 1 : 0.5));

  // Heel and foot (near ankle)
  const visHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
  const hidHeel = side === 'left' ? IDX.rightHeel : IDX.leftHeel;
  const visFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;
  const hidFoot = side === 'left' ? IDX.rightFootIndex : IDX.leftFootIndex;
  pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
  pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01, visibility * 0.5);
  pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,        visibility);
  pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// BURPEE -- side-facing pose
//
// The burpee is a multi-phase exercise. The entire state machine is driven
// by hip Y offset from a standing baseline. We synthesise the body position
// from this single offset:
//
//   hipYOffset = 0      â†’ standing: vertical body
//   hipYOffset = +0.05  â†’ squat: hips dropped, knees bent
//   hipYOffset = +0.15  â†’ plank: body horizontal
//   hipYOffset = -0.05  â†’ jump: body above standing baseline
//
// For plank and squat phases, kneeAngleDeg controls the knee geometry.
// ------------------------------------------------------------------------

export function buildBurpeePose(intent: BurpeePoseIntent | null): PoseLandmarks {
  if (intent === null) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }

  const {
    hipYOffset,
    hipPlankDeviation = 0,
    side = 'left',
    bodyHeight = 0.62,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  // Determine phase-appropriate knee angle if not specified
  const isPlankPhase = hipYOffset >= 0.10;
  const isSquatPhase = hipYOffset >= 0.03 && !isPlankPhase;
  const kneeAngleDeg = intent.kneeAngleDeg ??
    (isPlankPhase ? 170 : isSquatPhase ? 80 : 170);

  const pose = emptyPose();

  if (isPlankPhase) {
    // Horizontal plank body (similar to buildMountainClimberPose)
    const shoulderX = 0.15;
    const ankleX = shoulderX + bodyHeight;
    const hipX = (shoulderX + ankleX) / 2;
    // Compute the plank hip Y consistent with the vertical-phase baseline.
    // The engine captures baseline from vertical pose: baseHipY = 0.88 - HIP_FRAC * span.
    // hipYOffset is the drop FROM that baseline, so plankHipY = baseHipY + hipYOffset.
    const vertAnkleY = 0.88;
    const HIP_FRAC_V = 0.35; // matches vertical: 1 - HIP_FROM_SHOULDER_FRAC(0.65)
    const actualSpanV = bodyHeight > 0.10 ? bodyHeight : 0.51;
    const baseHipY_vert = vertAnkleY - HIP_FRAC_V * actualSpanV;
    const plankHipY = baseHipY_vert + hipYOffset;
    const shoulderY = plankHipY;
    const ankleY = plankHipY;
    const hipY = plankHipY + hipPlankDeviation;

    // Knee: interpolate between hip and ankle horizontally (plank body line).
    // For near-straight leg (170Â°), knee sits midway with tiny downward Y offset.
    // This produces kneeExtensionDeg > 150 as required by PLANK_KNEE_THRESHOLD.
    const kneeX = (hipX + ankleX) / 2;
    const flexRad = ((180 - kneeAngleDeg) * Math.PI) / 180; // small for near-straight
    const halfHorizSpan = (ankleX - hipX) / 2;
    const kneeY = hipY + halfHorizSpan * Math.sin(flexRad * 0.5);

    const wristX = shoulderX;
    const wristY = shoulderY + 0.12;
    const elbowX = shoulderX;
    const elbowY = shoulderY + 0.06;

    const visSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
    const hidSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
    const visHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
    const hidHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
    const visKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
    const hidKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
    const visAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
    const hidAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
    const visElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
    const hidElbow = side === 'left' ? IDX.rightElbow : IDX.leftElbow;
    const visWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
    const hidWrist = side === 'left' ? IDX.rightWrist : IDX.leftWrist;

    pose[visSh]    = makeLandmark(shoulderX,         shoulderY,         visibility);
    pose[visHip]   = makeLandmark(hipX,              hipY,              visibility);
    pose[visKnee]  = makeLandmark(kneeX,             kneeY,             visibility);
    pose[visAnkle] = makeLandmark(ankleX,            ankleY,            visibility);
    pose[visElbow] = makeLandmark(elbowX,            elbowY,            visibility);
    pose[visWrist] = makeLandmark(wristX,            wristY,            visibility);

    pose[hidSh]    = makeLandmark(shoulderX + 0.005, shoulderY + 0.005, visibility * 0.5);
    pose[hidHip]   = makeLandmark(hipX      + 0.005, hipY      + 0.005, visibility * 0.5);
    pose[hidKnee]  = makeLandmark(kneeX     + 0.005, kneeY     + 0.005, visibility * 0.5);
    pose[hidAnkle] = makeLandmark(ankleX    - 0.005, ankleY    + 0.005, visibility * 0.5);
    pose[hidElbow] = makeLandmark(elbowX    + 0.005, elbowY    + 0.005, visibility * 0.5);
    pose[hidWrist] = makeLandmark(wristX    + 0.005, wristY    + 0.005, visibility * 0.5);

    pose[IDX.nose]     = makeLandmark(shoulderX - 0.05, shoulderY - 0.03, visibility);
    pose[IDX.leftEar]  = makeLandmark(shoulderX - 0.04, shoulderY - 0.02, visibility * (side === 'left' ? 1 : 0.5));
    pose[IDX.rightEar] = makeLandmark(shoulderX - 0.04, shoulderY - 0.02, visibility * (side === 'right' ? 1 : 0.5));

    const visHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
    const hidHeel = side === 'left' ? IDX.rightHeel : IDX.leftHeel;
    const visFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;
    const hidFoot = side === 'left' ? IDX.rightFootIndex : IDX.leftFootIndex;
    pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
    pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01, visibility * 0.5);
    pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,        visibility);
    pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);
  } else {
    // Vertical body (standing, squatting, rising, jumping) â€” side-facing.
    // bodyHeight is the ankle-to-shoulder span (default 0.62 â†’ passes [0.50, 0.90]).
    // Proportions: hip is 65% down from shoulder (= 35% up from ankle).
    const HIP_FROM_SHOULDER_FRAC = 0.65;   // hip is 65% down from shoulder

    const ankleX = 0.50;
    const ankleY = 0.88;

    const shoulderX = 0.50;
    // Shoulder is bodyHeight above ankle
    const baseShouderY = ankleY - bodyHeight;
    const baseHipY = baseShouderY + HIP_FROM_SHOULDER_FRAC * bodyHeight;

    const hipX = 0.50;
    // hipYOffset adds to hip Y (positive = hips drop lower = higher Y value)
    const hipY = baseHipY + hipYOffset;
    const shoulderY = baseShouderY; // shoulder stays fixed

    // Knee: midpoint Y, with slight forward X offset for squat bend
    const lowerLegLen = bodyHeight * (1 - HIP_FROM_SHOULDER_FRAC); // = 35% of bodyHeight
    const kneeRad = ((180 - kneeAngleDeg) / 2) * Math.PI / 180;
    const kneeOffset = lowerLegLen * Math.sin(kneeRad) * 0.5;
    const kneeX = hipX + kneeOffset;
    const kneeY = (hipY + ankleY) / 2;

    const wristX = shoulderX - 0.05;
    const wristY = hipY + 0.04;               // arms hang at hip level
    const elbowX = shoulderX - 0.02;
    const elbowY = (shoulderY + wristY) / 2;

    const headX = shoulderX + 0.04;
    const headY = shoulderY - 0.08;

    const visSh = side === 'left' ? IDX.leftShoulder : IDX.rightShoulder;
    const hidSh = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
    const visHip = side === 'left' ? IDX.leftHip : IDX.rightHip;
    const hidHip = side === 'left' ? IDX.rightHip : IDX.leftHip;
    const visKnee = side === 'left' ? IDX.leftKnee : IDX.rightKnee;
    const hidKnee = side === 'left' ? IDX.rightKnee : IDX.leftKnee;
    const visAnkle = side === 'left' ? IDX.leftAnkle : IDX.rightAnkle;
    const hidAnkle = side === 'left' ? IDX.rightAnkle : IDX.leftAnkle;
    const visElbow = side === 'left' ? IDX.leftElbow : IDX.rightElbow;
    const hidElbow = side === 'left' ? IDX.rightElbow : IDX.leftElbow;
    const visWrist = side === 'left' ? IDX.leftWrist : IDX.rightWrist;
    const hidWrist = side === 'left' ? IDX.rightWrist : IDX.leftWrist;

    pose[visSh]    = makeLandmark(shoulderX,         shoulderY,         visibility);
    pose[visHip]   = makeLandmark(hipX,              hipY,              visibility);
    pose[visKnee]  = makeLandmark(kneeX,             kneeY,             visibility);
    pose[visAnkle] = makeLandmark(ankleX,            ankleY,            visibility);
    pose[visElbow] = makeLandmark(elbowX,            elbowY,            visibility);
    pose[visWrist] = makeLandmark(wristX,            wristY,            visibility);

    pose[hidSh]    = makeLandmark(shoulderX + 0.01,  shoulderY + 0.005, visibility * 0.5);
    pose[hidHip]   = makeLandmark(hipX      + 0.01,  hipY      + 0.005, visibility * 0.5);
    pose[hidKnee]  = makeLandmark(kneeX     + 0.01,  kneeY     + 0.005, visibility * 0.5);
    pose[hidAnkle] = makeLandmark(ankleX    + 0.01,  ankleY    + 0.005, visibility * 0.5);
    pose[hidElbow] = makeLandmark(elbowX    + 0.01,  elbowY    + 0.005, visibility * 0.5);
    pose[hidWrist] = makeLandmark(wristX    + 0.01,  wristY    + 0.005, visibility * 0.5);

    pose[IDX.nose]     = makeLandmark(headX,          headY,             visibility);
    pose[IDX.leftEar]  = makeLandmark(headX - 0.03,   headY + 0.01,      visibility * (side === 'left' ? 1 : 0.5));
    pose[IDX.rightEar] = makeLandmark(headX + 0.03,   headY + 0.01,      visibility * (side === 'right' ? 1 : 0.5));

    const visHeel = side === 'left' ? IDX.leftHeel : IDX.rightHeel;
    const hidHeel = side === 'left' ? IDX.rightHeel : IDX.leftHeel;
    const visFoot = side === 'left' ? IDX.leftFootIndex : IDX.rightFootIndex;
    const hidFoot = side === 'left' ? IDX.rightFootIndex : IDX.leftFootIndex;
    pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
    pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01, visibility * 0.5);
    pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,        visibility);
    pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);
  }

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// BOX JUMP -- side-facing vertical body (standing/loading/airborne/landing)
// ------------------------------------------------------------------------

/**
 * Synthesizes a side-facing standing pose for box jump scenarios.
 * The hip Y position is the primary signal; kneeAngleDeg modulates the knee.
 *
 * Calibration baseline: hipYOffset=0, kneeAngleDeg=170 (standing upright).
 * Loading:  hipYOffset=+0.04, kneeAngleDeg=130-140 (quarter-squat dip).
 * Airborne: hipYOffset=-0.10, kneeAngleDeg=170 (body flying up).
 * Landing:  hipYOffset=-0.02, kneeAngleDeg=90 (absorbing on box).
 */
export function buildBoxJumpPose(intent: BoxJumpPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }

  const {
    hipYOffset,
    kneeAngleDeg = 170,
    side = 'left',
    bodyHeight = 0.65,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Segment lengths (normalised frame units)
  // bodyHeight = shoulder-to-ankle Y span; default 0.65 â†’ 0.51 actual span
  // To honour the bodyHeight intent, scale shoulder position from ankle up.
  const ankleX = 0.50;
  const baseAnkleY = 0.88;
  const ankleY = baseAnkleY;

  // Use bodyHeight to set shoulder position (enables calibration distance gate tests)
  // Default 0.65 â†’ shoulderY = 0.88 - 0.51 = 0.37 (matches original fixed layout)
  const DEFAULT_BH = 0.51; // original default body span
  const actualSpan = bodyHeight > 0.10 ? bodyHeight : DEFAULT_BH;
  const shoulderSpan = actualSpan; // shoulder-to-ankle Y distance

  const TORSO_FRAC = 0.15 / (0.15 + 0.18 + 0.18); // torso / total
  const HIP_FRAC   = (0.18 + 0.18) / (0.15 + 0.18 + 0.18); // hip above ankle / total

  // Hip Y: baseline (hipYOffset=0) = ankleY - HIP_FRAC * actualSpan
  const baseHipY = ankleY - HIP_FRAC * actualSpan;
  const hipX = 0.50;
  const hipY = baseHipY + hipYOffset;

  // Knee: placed between hip and ankle, offset laterally to achieve knee angle
  const kneeRad = ((180 - kneeAngleDeg) / 2) * Math.PI / 180;
  const lowerLeg = (1 - TORSO_FRAC) * actualSpan * 0.5; // half the non-torso span
  const kneeOffset = lowerLeg * Math.sin(kneeRad) * 0.5;
  const kneeX = hipX + kneeOffset;
  const kneeY = (hipY + ankleY) / 2;

  // Shoulder is above hip (use span-based calculation)
  const shoulderX = hipX;
  const shoulderY = ankleY - shoulderSpan;

  // Arms hang at hip level when standing/loading; swing forward on jump
  const wristX = shoulderX - 0.05;
  const wristY = hipY + 0.03;
  const elbowX = shoulderX - 0.02;
  const elbowY = (shoulderY + wristY) / 2;

  const headX = shoulderX + 0.04;
  const headY = shoulderY - 0.08;

  const visSh    = side === 'left' ? IDX.leftShoulder  : IDX.rightShoulder;
  const hidSh    = side === 'left' ? IDX.rightShoulder : IDX.leftShoulder;
  const visHip   = side === 'left' ? IDX.leftHip       : IDX.rightHip;
  const hidHip   = side === 'left' ? IDX.rightHip      : IDX.leftHip;
  const visKnee  = side === 'left' ? IDX.leftKnee      : IDX.rightKnee;
  const hidKnee  = side === 'left' ? IDX.rightKnee     : IDX.leftKnee;
  const visAnkle = side === 'left' ? IDX.leftAnkle     : IDX.rightAnkle;
  const hidAnkle = side === 'left' ? IDX.rightAnkle    : IDX.leftAnkle;
  const visElbow = side === 'left' ? IDX.leftElbow     : IDX.rightElbow;
  const hidElbow = side === 'left' ? IDX.rightElbow    : IDX.leftElbow;
  const visWrist = side === 'left' ? IDX.leftWrist     : IDX.rightWrist;
  const hidWrist = side === 'left' ? IDX.rightWrist    : IDX.leftWrist;

  pose[visSh]    = makeLandmark(shoulderX,         shoulderY,         visibility);
  pose[visHip]   = makeLandmark(hipX,              hipY,              visibility);
  pose[visKnee]  = makeLandmark(kneeX,             kneeY,             visibility);
  pose[visAnkle] = makeLandmark(ankleX,            ankleY,            visibility);
  pose[visElbow] = makeLandmark(elbowX,            elbowY,            visibility);
  pose[visWrist] = makeLandmark(wristX,            wristY,            visibility);

  pose[hidSh]    = makeLandmark(shoulderX + 0.01,  shoulderY + 0.005, visibility * 0.5);
  pose[hidHip]   = makeLandmark(hipX      + 0.01,  hipY      + 0.005, visibility * 0.5);
  pose[hidKnee]  = makeLandmark(kneeX     + 0.01,  kneeY     + 0.005, visibility * 0.5);
  pose[hidAnkle] = makeLandmark(ankleX    + 0.01,  ankleY    + 0.005, visibility * 0.5);
  pose[hidElbow] = makeLandmark(elbowX    + 0.01,  elbowY    + 0.005, visibility * 0.5);
  pose[hidWrist] = makeLandmark(wristX    + 0.01,  wristY    + 0.005, visibility * 0.5);

  pose[IDX.nose]     = makeLandmark(headX,        headY,          visibility);
  pose[IDX.leftEar]  = makeLandmark(headX - 0.03, headY + 0.01,   visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(headX + 0.03, headY + 0.01,   visibility * (side === 'right' ? 1 : 0.5));

  const visHeel = side === 'left' ? IDX.leftHeel       : IDX.rightHeel;
  const hidHeel = side === 'left' ? IDX.rightHeel      : IDX.leftHeel;
  const visFoot = side === 'left' ? IDX.leftFootIndex  : IDX.rightFootIndex;
  const hidFoot = side === 'left' ? IDX.rightFootIndex : IDX.leftFootIndex;
  pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01,  visibility);
  pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01,  visibility * 0.5);
  pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,         visibility);
  pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// PLANK -- side-facing pose (left side visible by default)
// ------------------------------------------------------------------------

export function buildKBSwingPose(intent: KBSwingPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    // Invisible pose (occlusion / position-lost)
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }
  const {
    hipHingeDeg: hingeDeg = 0,
    extraKneeBend = 0,
    armLift = false,
    roundedBack = false,
    side = 'left',
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const ankleX = 0.50;
  const ankleY = 0.85;
  // Extra knee bend shifts knee forward (simulates squat-pattern)
  const kneeX = 0.50 + extraKneeBend * 0.003;
  const kneeY = ankleY - KB_LOWER_LEG + extraKneeBend * 0.002;
  const hipX = 0.50;
  const hipY = kneeY - KB_UPPER_LEG;

  // Shoulder rotates around hip as hinge increases (same as deadlift)
  const hingeRad = (hingeDeg * Math.PI) / 180;
  const shoulderXBase = hipX + KB_TORSO * Math.sin(hingeRad);
  const shoulderYBase = hipY - KB_TORSO * Math.cos(hingeRad);
  // roundedBack: drop shoulder 0.08 below its natural position so torsoAngleDeg > 88Â°
  const shoulderX = shoulderXBase;
  const shoulderY = roundedBack ? hipY + 0.06 : shoulderYBase;

  const headX = shoulderX + 0.04;
  const headY = shoulderY - 0.08;

  // Wrist placement: armLift = wrist above shoulder (arm-lift error)
  // Normal: wrist at hip level (arms passively hanging / holding KB)
  const wristX = shoulderX - 0.02;
  const wristY = armLift ? shoulderY - 0.12 : hipY + 0.04;
  const elbowX = shoulderX;
  const elbowY = (shoulderY + wristY) / 2;

  const [visSh, hidSh] = side === 'left'
    ? [IDX.leftShoulder, IDX.rightShoulder]
    : [IDX.rightShoulder, IDX.leftShoulder];
  const [visHip, hidHip] = side === 'left'
    ? [IDX.leftHip, IDX.rightHip]
    : [IDX.rightHip, IDX.leftHip];
  const [visKnee, hidKnee] = side === 'left'
    ? [IDX.leftKnee, IDX.rightKnee]
    : [IDX.rightKnee, IDX.leftKnee];
  const [visAnkle, hidAnkle] = side === 'left'
    ? [IDX.leftAnkle, IDX.rightAnkle]
    : [IDX.rightAnkle, IDX.leftAnkle];
  const [visElbow, hidElbow] = side === 'left'
    ? [IDX.leftElbow, IDX.rightElbow]
    : [IDX.rightElbow, IDX.leftElbow];
  const [visWrist, hidWrist] = side === 'left'
    ? [IDX.leftWrist, IDX.rightWrist]
    : [IDX.rightWrist, IDX.leftWrist];

  pose[visSh]    = makeLandmark(shoulderX,       shoulderY,      visibility);
  pose[visHip]   = makeLandmark(hipX,            hipY,           visibility);
  pose[visKnee]  = makeLandmark(kneeX,           kneeY,          visibility);
  pose[visAnkle] = makeLandmark(ankleX,          ankleY,         visibility);
  pose[visElbow] = makeLandmark(elbowX,          elbowY,         visibility);
  pose[visWrist] = makeLandmark(wristX,          wristY,         visibility);

  pose[hidSh]    = makeLandmark(shoulderX + 0.01, shoulderY + 0.005, visibility * 0.5);
  pose[hidHip]   = makeLandmark(hipX      + 0.01, hipY      + 0.005, visibility * 0.5);
  pose[hidKnee]  = makeLandmark(kneeX     + 0.01, kneeY     + 0.005, visibility * 0.5);
  pose[hidAnkle] = makeLandmark(ankleX    + 0.01, ankleY    + 0.005, visibility * 0.5);
  pose[hidElbow] = makeLandmark(elbowX    + 0.01, elbowY    + 0.005, visibility * 0.5);
  pose[hidWrist] = makeLandmark(wristX    + 0.01, wristY    + 0.005, visibility * 0.5);

  pose[IDX.nose]     = makeLandmark(headX,        headY,          visibility);
  pose[IDX.leftEar]  = makeLandmark(headX - 0.03, headY + 0.01, visibility * (side === 'left' ? 1 : 0.5));
  pose[IDX.rightEar] = makeLandmark(headX + 0.03, headY + 0.01, visibility * (side === 'right' ? 1 : 0.5));

  // Side-profile calibration gate: both shoulders must have X-diff > 0.04.
  // The 'vis' shoulder is at shoulderX; place the back shoulder 0.08 back.
  if (side === 'left') {
    pose[IDX.rightShoulder] = makeLandmark(shoulderX - 0.08, shoulderY + 0.01, visibility * 0.7);
  } else {
    pose[IDX.leftShoulder] = makeLandmark(shoulderX + 0.08, shoulderY + 0.01, visibility * 0.7);
  }

  const [visHeel, hidHeel] = side === 'left'
    ? [IDX.leftHeel, IDX.rightHeel]
    : [IDX.rightHeel, IDX.leftHeel];
  const [visFoot, hidFoot] = side === 'left'
    ? [IDX.leftFootIndex, IDX.rightFootIndex]
    : [IDX.rightFootIndex, IDX.leftFootIndex];
  pose[visHeel] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
  pose[hidHeel] = makeLandmark(ankleX + 0.01, ankleY + 0.01, visibility * 0.5);
  pose[visFoot] = makeLandmark(ankleX + 0.02, ankleY,        visibility);
  pose[hidFoot] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// LATERAL RAISE -- front-facing standing pose
//
// At armAbductionDeg=0: arms at sides, wrists hang at hip level.
// At armAbductionDeg=90: arms parallel to floor, wrists at shoulder level.
// At armAbductionDeg > 90: above parallel (above-parallel error territory).
//
// Geometry for each arm:
//   wristX = shoulderX +/- LAT_ARM_L_TOTAL * sin(thetaRad)
//   wristY = shoulderY + LAT_ARM_L_TOTAL * cos(thetaRad)
//
// Where theta=0 -> arm straight down, theta=90 -> arm horizontal.
// torsoSwingOffset shifts shoulder midpoint X (torso swing error).
// ------------------------------------------------------------------------

const LAT_ARM_L_TOTAL = 0.26; // upper arm + forearm combined in normalised coords

function latRaiseArmGeom(
  shoulderX: number,
  shoulderY: number,
  abductionDeg: number,
  side: 'left' | 'right',
) {
  const thetaRad = (abductionDeg * Math.PI) / 180;
  const sign = side === 'left' ? -1 : 1;
  const wristX = shoulderX + sign * LAT_ARM_L_TOTAL * Math.sin(thetaRad);
  const wristY = shoulderY + LAT_ARM_L_TOTAL * Math.cos(thetaRad);
  const halfL = LAT_ARM_L_TOTAL / 2;
  const elbowX = shoulderX + sign * halfL * Math.sin(thetaRad);
  const elbowY = shoulderY + halfL * Math.cos(thetaRad);
  return { wristX, wristY, elbowX, elbowY };
}

export function buildStarJumpPose(intent: StarJumpPoseIntent): PoseLandmarks {
  const {
    armRaiseDeg,
    leftArmRaiseDeg,
    rightArmRaiseDeg,
    feetSpreadRatio = 1.0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetSpreadRatio) / 2;
  const ankleXLeft  = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;
  const ankleYsj = baseAnkleY;

  const hipMidX    = cx;
  const hipMidY    = baseAnkleY - 0.40;
  const shoulderMidX = cx;
  const shoulderMidY = hipMidY - 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  pose[IDX.nose]     = makeLandmark(shoulderMidX,         headY,        visibility);
  pose[IDX.leftEye]  = makeLandmark(shoulderMidX - 0.02,  headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(shoulderMidX + 0.02,  headY - 0.01, visibility);
  pose[IDX.leftEar]  = makeLandmark(shoulderMidX - 0.035, headY,        visibility);
  pose[IDX.rightEar] = makeLandmark(shoulderMidX + 0.035, headY,        visibility);

  const leftShoulderX  = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder]  = makeLandmark(leftShoulderX,  shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip]  = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  const leftRaise  = leftArmRaiseDeg  ?? armRaiseDeg;
  const rightRaise = rightArmRaiseDeg ?? armRaiseDeg;
  const sjLeftArm  = starJumpArmGeom(leftShoulderX,  shoulderMidY, leftRaise,  'left');
  const sjRightArm = starJumpArmGeom(rightShoulderX, shoulderMidY, rightRaise, 'right');

  pose[IDX.leftElbow]  = makeLandmark(sjLeftArm.elbowX,  sjLeftArm.elbowY,  visibility);
  pose[IDX.rightElbow] = makeLandmark(sjRightArm.elbowX, sjRightArm.elbowY, visibility);
  pose[IDX.leftWrist]  = makeLandmark(sjLeftArm.wristX,  sjLeftArm.wristY,  visibility);
  pose[IDX.rightWrist] = makeLandmark(sjRightArm.wristX, sjRightArm.wristY, visibility);

  const kneeYsj = (hipMidY + ankleYsj) / 2;
  pose[IDX.leftKnee]  = makeLandmark(ankleXLeft,  kneeYsj, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeYsj, visibility);
  pose[IDX.leftAnkle]  = makeLandmark(ankleXLeft,  ankleYsj, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleYsj, visibility);
  pose[IDX.leftHeel]   = makeLandmark(ankleXLeft  - 0.005, ankleYsj + 0.01, visibility);
  pose[IDX.rightHeel]  = makeLandmark(ankleXRight + 0.005, ankleYsj + 0.01, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(ankleXLeft  + 0.02, ankleYsj, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleYsj, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// GLUTE BRIDGE -- side-facing lying-down pose (user on back, knees bent).
//
// The user lies horizontally with the camera at their side.
// At rest (hipRise=0): hips at floor level (y=0.8425).
// At full bridge (hipRise=1): hips raised by kneeAboveHipY â‰ˆ 0.2675.
//
// Calibration geometry (hipRise=0):
//   shoulderMid: xâ‰ˆ0.225, y=0.76
//   hipMid:      xâ‰ˆ0.50,  y=0.8425  â†’ restingHipY
//   kneeMid:     xâ‰ˆ0.57,  y=0.5725  â†’ kneeAboveHipY = 0.2700
//   ankleMid:    xâ‰ˆ0.65,  y=0.8425
//
// Both sides are made fully visible (in a lying-down position MediaPipe
// can track both left and right landmarks simultaneously).
// ------------------------------------------------------------------------

const GB_KABY = 0.2675; // kneeAboveHipY: hipMid.y(0.8425) - kneeMid.y(0.5725)

export function buildGluteBridgePose(intent: GluteBridgePoseIntent | null): PoseLandmarks {
  if (intent === null) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }

  const {
    hipRise,
    kneeBentOverride = false,
    hipsUpAtRest = false,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Floor Y for hips / ankles
  const HIP_REST_Y = 0.8425;
  const ANKLE_Y    = 0.8425;
  const SHOULDER_Y = 0.76;    // shoulders stay on floor
  const KNEE_Y     = 0.5725;  // knees raised throughout

  // Hip Y rises by hipRise * GB_KABY (y decreases = upward)
  const currentHipY = HIP_REST_Y - hipRise * GB_KABY;

  // Override gates for calibration failure tests
  const actualHipY   = hipsUpAtRest ? HIP_REST_Y - 0.20 : currentHipY;
  const actualKneeY  = kneeBentOverride ? HIP_REST_Y + 0.02 : KNEE_Y;

  // Left side (primary, slightly left of centre)
  pose[IDX.leftShoulder] = makeLandmark(0.220, SHOULDER_Y,  visibility);
  pose[IDX.leftHip]      = makeLandmark(0.490, actualHipY,  visibility);
  pose[IDX.leftKnee]     = makeLandmark(0.560, actualKneeY, visibility);
  pose[IDX.leftAnkle]    = makeLandmark(0.640, ANKLE_Y,     visibility);
  pose[IDX.leftWrist]    = makeLandmark(0.240, SHOULDER_Y + 0.04, visibility);
  pose[IDX.leftElbow]    = makeLandmark(0.300, SHOULDER_Y + 0.02, visibility);

  // Right side (slightly right of centre, same visibility â€” lying down)
  pose[IDX.rightShoulder] = makeLandmark(0.230, SHOULDER_Y  + 0.005, visibility);
  pose[IDX.rightHip]      = makeLandmark(0.510, actualHipY  + 0.005, visibility);
  pose[IDX.rightKnee]     = makeLandmark(0.580, actualKneeY + 0.005, visibility);
  pose[IDX.rightAnkle]    = makeLandmark(0.660, ANKLE_Y     + 0.005, visibility);
  pose[IDX.rightWrist]    = makeLandmark(0.240, SHOULDER_Y + 0.045,  visibility);
  pose[IDX.rightElbow]    = makeLandmark(0.300, SHOULDER_Y + 0.025,  visibility);

  // Head landmarks (above/near shoulder, side-on)
  pose[IDX.nose]     = makeLandmark(0.170, SHOULDER_Y - 0.03, visibility);
  pose[IDX.leftEar]  = makeLandmark(0.180, SHOULDER_Y - 0.02, visibility);
  pose[IDX.rightEar] = makeLandmark(0.190, SHOULDER_Y - 0.015, visibility * 0.7);

  // Heel / foot (near ankle)
  pose[IDX.leftHeel]       = makeLandmark(0.630, ANKLE_Y + 0.01,  visibility);
  pose[IDX.rightHeel]      = makeLandmark(0.650, ANKLE_Y + 0.012, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(0.655, ANKLE_Y,         visibility);
  pose[IDX.rightFootIndex] = makeLandmark(0.675, ANKLE_Y + 0.005, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// OVERHEAD TRICEP EXTENSION -- front-facing, arms overhead
//
// Geometry:
//   shoulderY = 0.35  (at ~35% down the frame)
//   elbowY    = shoulderY - UPPER_ARM_L  (elbow is ABOVE shoulder: smaller y)
//   wristY    = elbowY    - UPPER_ARM_L * extensionLevel
//
//   extensionLevel=1.0 â†’ wrist is one full upper-arm-length above elbow (extended)
//   extensionLevel=0.0 â†’ wrist is at elbow level (forearms horizontal)
//
// The engine's tricepExtDeg = (elbow.y - wrist.y) / upperArmLen Ã— 90
//   = extensionLevel Ã— 90
// So at extensionLevel=1.0: tricepExtDegâ‰ˆ90Â° (extended)
//    at extensionLevel=0.0: tricepExtDegâ‰ˆ0Â°  (bottom)
// ------------------------------------------------------------------------

const OTE_UPPER_ARM_L = 0.13;
const OTE_FOREARM_L   = 0.13;

export function buildOTEPose(intent: OTEPoseIntent): PoseLandmarks {
  const {
    extensionLevel,
    leftExtensionLevel,
    rightExtensionLevel,
    elbowFlareX = 0,
    torsoSwayX = 0,
    feetWidthRatio = 1.0,
    bodyHeight = 0.58,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50 + torsoSwayX;
  const baseAnkleY = 0.92;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft  = (cx - torsoSwayX) - ankleHalf;
  const ankleXRight = (cx - torsoSwayX) + ankleHalf;
  const ankleY = baseAnkleY;

  // bodyHeight = shoulder-to-ankle span (default 0.58 â‰ˆ natural standing span).
  // Used by calibration distance gate: BODY_HEIGHT_MIN=0.45, BODY_HEIGHT_MAX=0.92.
  const shoulderMidY = ankleY - bodyHeight;
  const shoulderMidX = cx;
  const hipMidX   = cx;
  const hipMidY   = shoulderMidY + 0.18;
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  pose[IDX.nose]      = makeLandmark(shoulderMidX, headY, visibility);
  pose[IDX.leftEye]   = makeLandmark(shoulderMidX - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye]  = makeLandmark(shoulderMidX + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar]   = makeLandmark(shoulderMidX - 0.035, headY, visibility);
  pose[IDX.rightEar]  = makeLandmark(shoulderMidX + 0.035, headY, visibility);

  const leftShoulderX  = shoulderMidX - shoulderHalf;
  const rightShoulderX = shoulderMidX + shoulderHalf;
  pose[IDX.leftShoulder]  = makeLandmark(leftShoulderX,  shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip]  = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Elbows sit directly above the shoulders (overhead position).
  // elbowFlareX moves them outward from the shoulder x-position.
  const leftElbowX  = leftShoulderX  - elbowFlareX;
  const rightElbowX = rightShoulderX + elbowFlareX;
  const elbowY      = shoulderMidY - OTE_UPPER_ARM_L;  // above shoulder

  const leftExt  = leftExtensionLevel  ?? extensionLevel;
  const rightExt = rightExtensionLevel ?? extensionLevel;

  // Wrist: above or at elbow depending on extension level.
  // wristY decreases (moves up in frame) as extensionLevel increases.
  const leftWristY  = elbowY - OTE_FOREARM_L * leftExt;
  const rightWristY = elbowY - OTE_FOREARM_L * rightExt;

  pose[IDX.leftElbow]  = makeLandmark(leftElbowX,  elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightElbowX, elbowY, visibility);
  pose[IDX.leftWrist]  = makeLandmark(leftElbowX,  leftWristY,  visibility);
  pose[IDX.rightWrist] = makeLandmark(rightElbowX, rightWristY, visibility);

  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee]  = makeLandmark(ankleXLeft,  kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle]  = makeLandmark(ankleXLeft,  ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel]   = makeLandmark(ankleXLeft  - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel]  = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(ankleXLeft  + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  void bodyHeight;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// BROAD JUMP -- front-facing, bilateral hip Y tracking
// Uses same isoceles-triangle geometry as squat for correct kneeFlexionDeg round-trip.
// hipYOffset shifts the hip (and knee) upward/downward while ankles remain fixed.
// ------------------------------------------------------------------------

export function buildBroadJumpPose(intent: BroadJumpPoseIntent): PoseLandmarks {
  const {
    hipYOffset = 0,
    kneeFlexionDeg: kneeFlex = 5,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();
  const vis = visibility;

  const centerX = 0.50;
  const shoulderW = 0.10;
  const feetW = 0.085;  // â‰ˆ85% of shoulder width â€” jump stance

  // Shoulder pinned at shoulderY=0.15 (constant).
  // ankleBase = shoulderY + bodyHeight â†’ |ankleBase - shoulderY| == bodyHeight.
  // This makes the calibration distance gate trigger at the correct bodyHeight values.
  const shoulderY = 0.15;
  const ankleBase = shoulderY + bodyHeight;

  // Hip base Y: calibration posture (kneeFlex=5 isoceles, hipYOffset=0).
  // seg=0.22, baseLen(5Â°) â‰ˆ 0.43958. Hip directly above ankle in isoceles model.
  const seg = 0.22;
  const calBaseLen = 2 * seg * Math.cos((5 / 2) * Math.PI / 180);  // â‰ˆ 0.43958
  const hipBaseY = ankleBase - calBaseLen;

  // Hip position depends ONLY on hipYOffset (not kneeFlex).
  // This guarantees hipDisp = rawHipY - baseline.hipY == hipYOffset exactly.
  const hipY = hipBaseY + hipYOffset;

  // Ankle stays fixed at the ground reference.
  const ankleY = ankleBase;

  // Knee: positioned to produce kneeFlex angle using the dynamic hip-ankle distance.
  // Formula: place knee at midpoint between hip and ankle (in Y), then swing
  // laterally by D/2 * tan(kneeFlex/2) where D = hip-ankle Y distance.
  // This preserves kneeFlexionDeg == kneeFlex regardless of hipYOffset.
  const D = Math.abs(ankleY - hipY);
  const kneeBaseY = (hipY + ankleY) / 2;
  const kneeLateral = D > 0
    ? (D / 2) * Math.tan((kneeFlex / 2) * Math.PI / 180)
    : 0;

  const hipXL = centerX - feetW;   // left ankle/hip X
  const hipXR = centerX + feetW;   // right ankle/hip X
  const lkX = hipXL - kneeLateral;  // left knee swings left
  const rkX = hipXR + kneeLateral;  // right knee swings right

  pose[IDX.leftShoulder] = makeLandmark(centerX - shoulderW, shoulderY, vis);
  pose[IDX.rightShoulder] = makeLandmark(centerX + shoulderW, shoulderY, vis);
  pose[IDX.leftElbow] = makeLandmark(centerX - shoulderW - 0.06, shoulderY + 0.09, vis);
  pose[IDX.rightElbow] = makeLandmark(centerX + shoulderW + 0.06, shoulderY + 0.09, vis);
  pose[IDX.leftWrist] = makeLandmark(centerX - shoulderW - 0.06, shoulderY + 0.21, vis);
  pose[IDX.rightWrist] = makeLandmark(centerX + shoulderW + 0.06, shoulderY + 0.21, vis);

  pose[IDX.leftHip] = makeLandmark(hipXL, hipY, vis);
  pose[IDX.rightHip] = makeLandmark(hipXR, hipY, vis);

  pose[IDX.leftKnee] = makeLandmark(lkX, kneeBaseY, vis);
  pose[IDX.rightKnee] = makeLandmark(rkX, kneeBaseY, vis);

  pose[IDX.leftAnkle] = makeLandmark(hipXL, ankleY, vis);
  pose[IDX.rightAnkle] = makeLandmark(hipXR, ankleY, vis);
  pose[IDX.leftHeel] = makeLandmark(hipXL, ankleY + 0.02, vis);
  pose[IDX.rightHeel] = makeLandmark(hipXR, ankleY + 0.02, vis);
  pose[IDX.leftFootIndex] = makeLandmark(hipXL + 0.02, ankleY + 0.03, vis);
  pose[IDX.rightFootIndex] = makeLandmark(hipXR - 0.02, ankleY + 0.03, vis);

  const noseY = shoulderY - 0.07;
  pose[IDX.nose] = makeLandmark(centerX, noseY, vis);
  pose[IDX.leftEye] = makeLandmark(centerX - 0.02, noseY - 0.01, vis);
  pose[IDX.rightEye] = makeLandmark(centerX + 0.02, noseY - 0.01, vis);
  pose[IDX.leftEar] = makeLandmark(centerX - 0.04, noseY, vis);
  pose[IDX.rightEar] = makeLandmark(centerX + 0.04, noseY, vis);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// DEAD BUG -- side-facing supine pose (user lies on back, camera to side).
//
// Geometry (side-camera, head at left, feet at right):
//   Floor Y: 0.76 (higher y = floor level in screen coords)
//   bodyLengthX controls the ankle x-span: ankle.x_rest = shoulder.x + bodyLengthX
//   This is what the calibration distance gate measures (ankle.x âˆ’ shoulder.x).
//   REST (legExtensionDeg=0, default bodyLengthX=0.55):
//     shoulder: (0.20, 0.76)  hip: (0.50, 0.76)
//     knee: (0.50, 0.54)      ankle: (0.75, 0.54)  [tabletop â€” knee above hip, shin horizontal]
//   EXTENDED (t=1): knee: (0.65, 0.72)  ankle: (0.85, 0.76) â†’ hip-knee-ankle â‰ˆ 154Â°
//   t = legExtensionDeg / 60 (linear interpolation for active leg)
// ------------------------------------------------------------------------

export function buildDeadBugPose(intent: DeadBugPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }

  const {
    legExtensionDeg,
    activeLeg = 'left',
    hipLiftAmount = 0,
    armsUp = true,
    bodyLengthX = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const FLOOR_Y    = 0.76;
  const SHOULDER_X = 0.20;

  // All x-positions scale with bodyLengthX so the calibration distance gate
  // (ankle.x âˆ’ shoulder.x) equals bodyLengthX exactly.
  const scale  = bodyLengthX / 0.55;
  const HIP_X  = SHOULDER_X + 0.30 * scale;   // 0.50 at default

  // Hip lift: positive = hips rising off floor (y decreases in screen coords)
  const hipY = FLOOR_Y - hipLiftAmount;

  // Active leg â€” interpolated from tabletop (t=0) to extended (t=1)
  const t = Math.min(1, Math.max(0, legExtensionDeg / 60));
  const ankleRestX = SHOULDER_X + bodyLengthX;              // 0.75 at default
  const ankleFarX  = SHOULDER_X + bodyLengthX + 0.10 * scale; // 0.85 at default
  const kneeFarX   = SHOULDER_X + 0.45 * scale;             // 0.65 at default

  const activeKneeX  = HIP_X      + t * (kneeFarX  - HIP_X);
  const activeKneeY  = 0.54       + t * (0.72 - 0.54);
  const activeAnkleX = ankleRestX + t * (ankleFarX - ankleRestX);
  const activeAnkleY = 0.54       + t * (0.76 - 0.54);

  // Inactive leg â€” always at tabletop
  const inactiveKneeX  = HIP_X;
  const inactiveKneeY  = 0.54;
  const inactiveAnkleX = ankleRestX;
  const inactiveAnkleY = 0.54;

  // Arms: up (wrist above shoulder) or at sides
  const wristY = armsUp ? FLOOR_Y - 0.31 : FLOOR_Y + 0.04;
  const elbowY = armsUp ? FLOOR_Y - 0.16 : FLOOR_Y + 0.02;

  // Left side
  pose[IDX.leftShoulder] = makeLandmark(SHOULDER_X,  FLOOR_Y, visibility);
  pose[IDX.leftHip]      = makeLandmark(HIP_X,       hipY,    visibility);
  pose[IDX.leftElbow]    = makeLandmark(SHOULDER_X,  elbowY,  visibility);
  pose[IDX.leftWrist]    = makeLandmark(SHOULDER_X,  wristY,  visibility);

  if (activeLeg === 'left') {
    pose[IDX.leftKnee]  = makeLandmark(activeKneeX,  activeKneeY,  visibility);
    pose[IDX.leftAnkle] = makeLandmark(activeAnkleX, activeAnkleY, visibility);
  } else {
    pose[IDX.leftKnee]  = makeLandmark(inactiveKneeX,  inactiveKneeY,  visibility);
    pose[IDX.leftAnkle] = makeLandmark(inactiveAnkleX, inactiveAnkleY, visibility);
  }

  // Right side (slight offset to differentiate)
  pose[IDX.rightShoulder] = makeLandmark(SHOULDER_X + 0.005, FLOOR_Y + 0.005, visibility);
  pose[IDX.rightHip]      = makeLandmark(HIP_X      + 0.005, hipY    + 0.005, visibility);
  pose[IDX.rightElbow]    = makeLandmark(SHOULDER_X + 0.005, elbowY  + 0.005, visibility);
  pose[IDX.rightWrist]    = makeLandmark(SHOULDER_X + 0.005, wristY  + 0.005, visibility);

  if (activeLeg === 'right') {
    pose[IDX.rightKnee]  = makeLandmark(activeKneeX  + 0.005, activeKneeY  + 0.005, visibility);
    pose[IDX.rightAnkle] = makeLandmark(activeAnkleX + 0.005, activeAnkleY + 0.005, visibility);
  } else {
    pose[IDX.rightKnee]  = makeLandmark(inactiveKneeX  + 0.005, inactiveKneeY  + 0.005, visibility);
    pose[IDX.rightAnkle] = makeLandmark(inactiveAnkleX + 0.005, inactiveAnkleY + 0.005, visibility);
  }

  // Head / nose (at left end of body, near shoulder)
  pose[IDX.nose]     = makeLandmark(SHOULDER_X - 0.04, FLOOR_Y - 0.04, visibility);
  pose[IDX.leftEar]  = makeLandmark(SHOULDER_X - 0.03, FLOOR_Y - 0.02, visibility);
  pose[IDX.rightEar] = makeLandmark(SHOULDER_X - 0.02, FLOOR_Y - 0.015, visibility * 0.7);

  // Heels / foot index (near ankles)
  pose[IDX.leftHeel]       = makeLandmark(pose[IDX.leftAnkle].x  - 0.01, pose[IDX.leftAnkle].y  + 0.01, visibility);
  pose[IDX.rightHeel]      = makeLandmark(pose[IDX.rightAnkle].x + 0.01, pose[IDX.rightAnkle].y + 0.01, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(pose[IDX.leftAnkle].x  + 0.02, pose[IDX.leftAnkle].y,         visibility);
  pose[IDX.rightFootIndex] = makeLandmark(pose[IDX.rightAnkle].x + 0.02, pose[IDX.rightAnkle].y,        visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// INCHWORM -- side-facing standing pose, primary metric = hip hinge.
//
// Geometry is identical to buildDeadliftPose: the inchworm forward-fold is
// a pure hip-hinge movement. Legs stay nearly straight throughout.
// Arms hang below the shoulder when upright (armsAtSides=true, calibration).
// ------------------------------------------------------------------------

export function buildInchwormPose(intent: InchwormPoseIntent): PoseLandmarks {
  const {
    hipHingeDeg: hingeDeg = 0,
    armsAtSides = true,
    side = 'left',
    bodyHeight = 0.62,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const LOWER_LEG = 0.22;
  const UPPER_LEG = 0.18;
  const TORSO     = Math.max(0.05, bodyHeight - LOWER_LEG - UPPER_LEG);

  const poseOut = emptyPose();

  const ankleX = 0.50;
  const ankleY = 0.85;
  const kneeX  = 0.50;
  const kneeY  = ankleY - LOWER_LEG;
  const hipX   = 0.50;
  const hipY   = kneeY - UPPER_LEG;

  const hingeRad  = (hingeDeg * Math.PI) / 180;
  const shoulderX = hipX + TORSO * Math.sin(hingeRad);
  const shoulderY = hipY - TORSO * Math.cos(hingeRad);

  const headX = shoulderX + 0.04;
  const headY = shoulderY - 0.08;

  const wristX  = shoulderX - 0.02;
  const wristY  = armsAtSides ? hipY + 0.04 : shoulderY - 0.15;
  const elbowX  = shoulderX;
  const elbowY  = (shoulderY + wristY) / 2;

  const [visSh, hidSh] = side === 'left'
    ? [IDX.leftShoulder, IDX.rightShoulder]
    : [IDX.rightShoulder, IDX.leftShoulder];
  const [visHip, hidHip] = side === 'left'
    ? [IDX.leftHip, IDX.rightHip]
    : [IDX.rightHip, IDX.leftHip];
  const [visKnee, hidKnee] = side === 'left'
    ? [IDX.leftKnee, IDX.rightKnee]
    : [IDX.rightKnee, IDX.leftKnee];
  const [visAnkle, hidAnkle] = side === 'left'
    ? [IDX.leftAnkle, IDX.rightAnkle]
    : [IDX.rightAnkle, IDX.leftAnkle];
  const [visElbow, hidElbow] = side === 'left'
    ? [IDX.leftElbow, IDX.rightElbow]
    : [IDX.rightElbow, IDX.leftElbow];
  const [visWrist, hidWrist] = side === 'left'
    ? [IDX.leftWrist, IDX.rightWrist]
    : [IDX.rightWrist, IDX.leftWrist];

  poseOut[visSh]    = makeLandmark(shoulderX,        shoulderY,        visibility);
  poseOut[visHip]   = makeLandmark(hipX,              hipY,             visibility);
  poseOut[visKnee]  = makeLandmark(kneeX,             kneeY,            visibility);
  poseOut[visAnkle] = makeLandmark(ankleX,            ankleY,           visibility);
  poseOut[visElbow] = makeLandmark(elbowX,            elbowY,           visibility);
  poseOut[visWrist] = makeLandmark(wristX,            wristY,           visibility);

  poseOut[hidSh]    = makeLandmark(shoulderX + 0.01,  shoulderY + 0.005, visibility * 0.5);
  poseOut[hidHip]   = makeLandmark(hipX      + 0.01,  hipY      + 0.005, visibility * 0.5);
  poseOut[hidKnee]  = makeLandmark(kneeX     + 0.01,  kneeY     + 0.005, visibility * 0.5);
  poseOut[hidAnkle] = makeLandmark(ankleX    + 0.01,  ankleY    + 0.005, visibility * 0.5);
  poseOut[hidElbow] = makeLandmark(elbowX    + 0.01,  elbowY    + 0.005, visibility * 0.5);
  poseOut[hidWrist] = makeLandmark(wristX    + 0.01,  wristY    + 0.005, visibility * 0.5);

  poseOut[IDX.nose]     = makeLandmark(headX,         headY,           visibility);
  poseOut[IDX.leftEar]  = makeLandmark(headX - 0.03,  headY + 0.01,   visibility * (side === 'left' ? 1 : 0.5));
  poseOut[IDX.rightEar] = makeLandmark(headX + 0.03,  headY + 0.01,   visibility * (side === 'right' ? 1 : 0.5));

  const [visHeel2, hidHeel2] = side === 'left'
    ? [IDX.leftHeel, IDX.rightHeel]
    : [IDX.rightHeel, IDX.leftHeel];
  const [visFoot2, hidFoot2] = side === 'left'
    ? [IDX.leftFootIndex, IDX.rightFootIndex]
    : [IDX.rightFootIndex, IDX.leftFootIndex];
  poseOut[visHeel2] = makeLandmark(ankleX - 0.01, ankleY + 0.01, visibility);
  poseOut[hidHeel2] = makeLandmark(ankleX + 0.01, ankleY + 0.01, visibility * 0.5);
  poseOut[visFoot2] = makeLandmark(ankleX + 0.02, ankleY,         visibility);
  poseOut[hidFoot2] = makeLandmark(ankleX + 0.02, ankleY + 0.005, visibility * 0.5);

  applyNoise(poseOut, noise, seed);
  applyOcclusion(poseOut, occludedIndices);
  return poseOut;
}

// ------------------------------------------------------------------------
// JUMP SQUAT -- front-facing, bilateral hip Y tracking
// Uses same isoceles-triangle geometry as squat for correct kneeFlexionDeg round-trip.
// hipYOffset shifts the hip (and knee) upward/downward while ankles remain fixed.
// ------------------------------------------------------------------------

export function buildJumpSquatPose(intent: JumpSquatPoseIntent): PoseLandmarks {
  const {
    hipYOffset = 0,
    kneeFlexionDeg: kneeFlex = 5,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();
  const vis = visibility;

  const centerX = 0.50;
  const shoulderW = 0.10;
  const feetW = 0.085;  // â‰ˆ85% of shoulder width â€” jump stance

  // Shoulder pinned at shoulderY=0.15 (constant).
  // ankleBase = shoulderY + bodyHeight â†’ |ankleBase - shoulderY| == bodyHeight.
  // This makes the calibration distance gate trigger at the correct bodyHeight values.
  const shoulderY = 0.15;
  const ankleBase = shoulderY + bodyHeight;

  // Hip base Y: calibration posture (kneeFlex=5 isoceles, hipYOffset=0).
  // seg=0.22, baseLen(5Â°) â‰ˆ 0.43958. Hip directly above ankle in isoceles model.
  const seg = 0.22;
  const calBaseLen = 2 * seg * Math.cos((5 / 2) * Math.PI / 180);  // â‰ˆ 0.43958
  const hipBaseY = ankleBase - calBaseLen;

  // Hip position depends ONLY on hipYOffset (not kneeFlex).
  // This guarantees hipDisp = rawHipY - baseline.hipY == hipYOffset exactly.
  const hipY = hipBaseY + hipYOffset;

  // Ankle stays fixed at the ground reference.
  const ankleY = ankleBase;

  // Knee: positioned to produce kneeFlex angle using the dynamic hip-ankle distance.
  // Formula: place knee at midpoint between hip and ankle (in Y), then swing
  // laterally by D/2 * tan(kneeFlex/2) where D = hip-ankle Y distance.
  // This preserves kneeFlexionDeg == kneeFlex regardless of hipYOffset.
  const D = Math.abs(ankleY - hipY);
  const kneeBaseY = (hipY + ankleY) / 2;
  const kneeLateral = D > 0
    ? (D / 2) * Math.tan((kneeFlex / 2) * Math.PI / 180)
    : 0;

  const hipXL = centerX - feetW;   // left ankle/hip X
  const hipXR = centerX + feetW;   // right ankle/hip X
  const lkX = hipXL - kneeLateral;  // left knee swings left
  const rkX = hipXR + kneeLateral;  // right knee swings right

  pose[IDX.leftShoulder] = makeLandmark(centerX - shoulderW, shoulderY, vis);
  pose[IDX.rightShoulder] = makeLandmark(centerX + shoulderW, shoulderY, vis);
  pose[IDX.leftElbow] = makeLandmark(centerX - shoulderW - 0.06, shoulderY + 0.09, vis);
  pose[IDX.rightElbow] = makeLandmark(centerX + shoulderW + 0.06, shoulderY + 0.09, vis);
  pose[IDX.leftWrist] = makeLandmark(centerX - shoulderW - 0.06, shoulderY + 0.21, vis);
  pose[IDX.rightWrist] = makeLandmark(centerX + shoulderW + 0.06, shoulderY + 0.21, vis);

  pose[IDX.leftHip] = makeLandmark(hipXL, hipY, vis);
  pose[IDX.rightHip] = makeLandmark(hipXR, hipY, vis);

  pose[IDX.leftKnee] = makeLandmark(lkX, kneeBaseY, vis);
  pose[IDX.rightKnee] = makeLandmark(rkX, kneeBaseY, vis);

  pose[IDX.leftAnkle] = makeLandmark(hipXL, ankleY, vis);
  pose[IDX.rightAnkle] = makeLandmark(hipXR, ankleY, vis);
  pose[IDX.leftHeel] = makeLandmark(hipXL, ankleY + 0.02, vis);
  pose[IDX.rightHeel] = makeLandmark(hipXR, ankleY + 0.02, vis);
  pose[IDX.leftFootIndex] = makeLandmark(hipXL + 0.02, ankleY + 0.03, vis);
  pose[IDX.rightFootIndex] = makeLandmark(hipXR - 0.02, ankleY + 0.03, vis);

  const noseY = shoulderY - 0.07;
  pose[IDX.nose] = makeLandmark(centerX, noseY, vis);
  pose[IDX.leftEye] = makeLandmark(centerX - 0.02, noseY - 0.01, vis);
  pose[IDX.rightEye] = makeLandmark(centerX + 0.02, noseY - 0.01, vis);
  pose[IDX.leftEar] = makeLandmark(centerX - 0.04, noseY, vis);
  pose[IDX.rightEar] = makeLandmark(centerX + 0.04, noseY, vis);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// SUPERMAN -- side-facing prone pose (face-down), shoulder elevation tracking.
//
// Geometry:
//   REST:   shoulder=(SHOULDER_X, FLOOR_Y), hip=(HIP_X, FLOOR_Y),
//           knee=(KNEE_X, FLOOR_Y), ankle=(ANKLE_X, FLOOR_Y)
//   AT_TOP: shoulderY = FLOOR_Y - shoulderRise (chest lifts off floor)
//           legs also rise slightly (ankleY = FLOOR_Y - shoulderRise * 0.5)
//
// Arms extend forward (wrist.x < shoulder.x - ARMS_FORWARD_OFFSET=0.06).
// shoulderRise=0 â†’ calibration (prone at rest).
// shoulderRise=0.08 â†’ above AT_TOP_THRESHOLD=0.06 â†’ full valid rep.
// ------------------------------------------------------------------------

export function buildSupermanPose(intent: SupermanPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i].visibility = 0;
    return pose;
  }

  const {
    shoulderRise,
    hipLiftOff = 0,
    armsForward = true,
    bodyLengthX = 0.55,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const FLOOR_Y    = 0.76;
  const SHOULDER_X = 0.20;

  // All x-positions scale with bodyLengthX so calibration distance gate works.
  const scale   = bodyLengthX / 0.55;
  const HIP_X   = SHOULDER_X + 0.30 * scale;  // 0.50 at default
  const KNEE_X  = SHOULDER_X + 0.45 * scale;  // 0.65 at default
  const ANKLE_X = SHOULDER_X + bodyLengthX;   // 0.75 at default

  // Chest rises: shoulderY decreases (y=0 is top in screen coords)
  const shoulderY = FLOOR_Y - shoulderRise;

  // Hip lift: positive = hips rising off floor (y decreases in screen coords)
  const hipY = FLOOR_Y - hipLiftOff;

  // Legs also lift slightly when chest rises (back extension)
  const legRise  = shoulderRise * 0.5;
  const ankleY   = FLOOR_Y - legRise;
  const kneeY    = FLOOR_Y - legRise * 0.7;

  // Arms extended forward: wrist is further left than shoulder
  // wrist.x < shoulder.x - 0.06 passes the armsForward gate
  const wristX  = armsForward ? SHOULDER_X - 0.10 * scale : SHOULDER_X + 0.02;
  const elbowX  = armsForward ? SHOULDER_X - 0.05 * scale : SHOULDER_X + 0.01;
  const wristY  = FLOOR_Y - shoulderRise * 0.3;
  const elbowY  = FLOOR_Y - shoulderRise * 0.15;

  // Left side (primary -- camera side)
  pose[IDX.leftShoulder] = makeLandmark(SHOULDER_X,  shoulderY, visibility);
  pose[IDX.leftHip]      = makeLandmark(HIP_X,       hipY,      visibility);
  pose[IDX.leftKnee]     = makeLandmark(KNEE_X,      kneeY,     visibility);
  pose[IDX.leftAnkle]    = makeLandmark(ANKLE_X,     ankleY,    visibility);
  pose[IDX.leftElbow]    = makeLandmark(elbowX,       elbowY,    visibility);
  pose[IDX.leftWrist]    = makeLandmark(wristX,       wristY,    visibility);

  // Right side (slight offset to differentiate)
  pose[IDX.rightShoulder] = makeLandmark(SHOULDER_X + 0.005, shoulderY + 0.005, visibility);
  pose[IDX.rightHip]      = makeLandmark(HIP_X      + 0.005, hipY      + 0.005, visibility);
  pose[IDX.rightKnee]     = makeLandmark(KNEE_X     + 0.005, kneeY     + 0.005, visibility);
  pose[IDX.rightAnkle]    = makeLandmark(ANKLE_X    + 0.005, ankleY    + 0.005, visibility);
  pose[IDX.rightElbow]    = makeLandmark(elbowX     + 0.005, elbowY    + 0.005, visibility);
  pose[IDX.rightWrist]    = makeLandmark(wristX     + 0.005, wristY    + 0.005, visibility);

  // Head / nose (near shoulder, slightly above)
  pose[IDX.nose]     = makeLandmark(SHOULDER_X - 0.04, shoulderY - 0.03, visibility);
  pose[IDX.leftEar]  = makeLandmark(SHOULDER_X - 0.03, shoulderY - 0.01, visibility);
  pose[IDX.rightEar] = makeLandmark(SHOULDER_X - 0.02, shoulderY - 0.005, visibility * 0.7);

  // Heels / foot index (near ankles)
  pose[IDX.leftHeel]       = makeLandmark(ANKLE_X - 0.01,        ankleY + 0.01,        visibility);
  pose[IDX.rightHeel]      = makeLandmark(ANKLE_X + 0.01 + 0.005, ankleY + 0.01 + 0.005, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(ANKLE_X + 0.02,        ankleY,               visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ANKLE_X + 0.02 + 0.005, ankleY + 0.005,      visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// SHRUG â€” front-facing standing pose with bilateral shoulder elevation.
// shoulderElevation raises both shoulders upward (decreasing Y in screen space).
// Geometry is identical to buildBicepCurlPose body layout.
// ------------------------------------------------------------------------

export function buildShrugPose(intent: ShrugPoseIntent): PoseLandmarks {
  const {
    shoulderElevation = 0,
    torsoSwing = 0,
    feetWidthRatio = 1.0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;
  const ankleY = baseAnkleY;

  // bodyHeight controls the shoulder-to-ankle span used by the distance gate.
  // Default geometry: ankleY - shoulderMidY â‰ˆ 0.58 (within the 0.45â€“0.92 range).
  // When bodyHeight is explicitly set, we derive shoulderMidY from it.
  const defaultBodyHeight = 0.58; // 0.92 - 0.34
  const effectiveBodyHeight = bodyHeight !== 0.70 ? bodyHeight : defaultBodyHeight;
  const shoulderMidY = ankleY - effectiveBodyHeight - shoulderElevation;

  // Torso swing: hip midpoint shifts horizontally
  const hipMidX = cx + torsoSwing;
  const hipMidY = shoulderMidY + 0.18; // hip is 0.18 below shoulder
  const headY = shoulderMidY - 0.10;
  const hipHalf = 0.06;

  pose[IDX.nose] = makeLandmark(cx, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(cx - 0.02, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(cx + 0.02, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(cx - 0.035, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(cx + 0.035, headY, visibility);

  const leftShoulderX = cx - shoulderHalf;
  const rightShoulderX = cx + shoulderHalf;
  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip] = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  // Arms hang at sides (elbows below shoulders, wrists below elbows)
  pose[IDX.leftElbow] = makeLandmark(leftShoulderX - 0.005, shoulderMidY + 0.13, visibility);
  pose[IDX.rightElbow] = makeLandmark(rightShoulderX + 0.005, shoulderMidY + 0.13, visibility);
  pose[IDX.leftWrist] = makeLandmark(leftShoulderX - 0.005, shoulderMidY + 0.26, visibility);
  pose[IDX.rightWrist] = makeLandmark(rightShoulderX + 0.005, shoulderMidY + 0.26, visibility);

  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee] = makeLandmark(ankleXLeft, kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

/**
 * Bird-Dog pose stub â€” side-camera, user on all fours facing RIGHT.
 * Head at camera-right, tail at camera-left.
 * The extending leg goes BACKWARD (camera-left) and UP.
 */
export function buildBirdDogPose(intent: BirdDogPoseIntent): PoseLandmarks {
  const {
    legExtension,
    activeLeg = 'right',
    bodySpan = 0.60,
    handsOverride = false,
    bodyNotHorizontal = false,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Scale factor: bodySpan controls how much of the frame width the body occupies
  const scale = bodySpan / 0.60;

  // Base geometry (user facing right, scale=1.0):
  const HEAD_X = 0.85, HEAD_Y = 0.22;
  const SHOULDER_X = 0.68, SHOULDER_Y = 0.42;
  const HIP_X = 0.45, HIP_Y = bodyNotHorizontal ? 0.30 : 0.42; // tilted if override
  const REST_KNEE_X = 0.45, REST_KNEE_Y = 0.60; // at rest: knee directly below hip
  const REST_ANKLE_X = 0.23, REST_ANKLE_Y = 0.60; // shin points LEFT, same Y as knee
  const WRIST_Y = handsOverride ? 0.30 : 0.74; // raised if override (fails handsDown gate)
  const ELBOW_X = 0.76, ELBOW_Y = 0.58;

  // Apply scale (scale around the shoulder point as anchor)
  const cx = SHOULDER_X;
  function scaleX(x: number) { return cx + (x - cx) * scale; }

  // Extending leg geometry: rotation model gives linear angle increase with legExtension.
  // Thigh rotates 75Â° CCW from "pointing down" as legExtension goes 0â†’1.
  // Shin always points LEFT (backward). This gives:
  //   legExtension=0: hip-knee-ankle â‰ˆ 90Â° (AT_REST, rawExtension â‰ˆ 0Â°)
  //   legExtension=0.375: extension â‰ˆ 28Â° (above EXTEND_START=20Â°, below AT_EXTENDED=50Â°)
  //   legExtension=0.875: extension â‰ˆ 66Â° (above AT_EXTENDED=50Â°)
  //   legExtension=1.0: extension â‰ˆ 75Â°
  const rotRad = legExtension * 75 * Math.PI / 180;
  const L_thigh = 0.18, L_shin = 0.22;
  const extKneeX = HIP_X - L_thigh * Math.sin(rotRad);
  const extKneeY = HIP_Y + L_thigh * Math.cos(rotRad);
  const extAnkleX = extKneeX - L_shin; // shin points LEFT
  const extAnkleY = extKneeY;

  // Near side (activeLeg side = the one we can clearly see)
  const [nearIdx, farIdx] = activeLeg === 'right'
    ? [{ knee: IDX.rightKnee, ankle: IDX.rightAnkle, hip: IDX.rightHip, shoulder: IDX.rightShoulder }
      ,{ knee: IDX.leftKnee,  ankle: IDX.leftAnkle,  hip: IDX.leftHip,  shoulder: IDX.leftShoulder  }]
    : [{ knee: IDX.leftKnee,  ankle: IDX.leftAnkle,  hip: IDX.leftHip,  shoulder: IDX.leftShoulder  }
      ,{ knee: IDX.rightKnee, ankle: IDX.rightAnkle, hip: IDX.rightHip, shoulder: IDX.rightShoulder }];

  // Set landmarks
  pose[IDX.nose]          = makeLandmark(scaleX(HEAD_X),     HEAD_Y,     visibility);
  pose[nearIdx.shoulder]  = makeLandmark(scaleX(SHOULDER_X), SHOULDER_Y, visibility);
  pose[farIdx.shoulder]   = makeLandmark(scaleX(SHOULDER_X), SHOULDER_Y + 0.01, visibility * 0.7);
  pose[nearIdx.hip]       = makeLandmark(scaleX(HIP_X),      HIP_Y,      visibility);
  pose[farIdx.hip]        = makeLandmark(scaleX(HIP_X),      HIP_Y + 0.01, visibility * 0.7);

  // Extending (active) leg
  pose[nearIdx.knee]      = makeLandmark(scaleX(extKneeX),   extKneeY,   visibility);
  pose[nearIdx.ankle]     = makeLandmark(scaleX(extAnkleX),  extAnkleY,  visibility);

  // Non-extending (rest) leg â€” stays in quadruped position
  pose[farIdx.knee]       = makeLandmark(scaleX(REST_KNEE_X + 0.03), REST_KNEE_Y, visibility * 0.6);
  pose[farIdx.ankle]      = makeLandmark(scaleX(REST_ANKLE_X + 0.03), REST_ANKLE_Y, visibility * 0.6);

  // Arms â€” on floor (wrists below shoulders)
  pose[IDX.rightWrist]    = makeLandmark(scaleX(0.80),    WRIST_Y,    visibility);
  pose[IDX.rightElbow]    = makeLandmark(scaleX(ELBOW_X), ELBOW_Y,    visibility);
  pose[IDX.leftWrist]     = makeLandmark(scaleX(0.45),    WRIST_Y,    visibility * 0.7);
  pose[IDX.leftElbow]     = makeLandmark(scaleX(ELBOW_X - 0.35), ELBOW_Y, visibility * 0.7);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

/**
 * Step-Up pose stub â€” front-facing camera, standing.
 * As hipRise increases, entire upper body shifts upward (hip Y decreases).
 * The step platform height is implicit in the hipRise value.
 */
export function buildStepUpPose(intent: StepUpPoseIntent): PoseLandmarks {
  const {
    hipRise,
    feetWidthRatio = 1.0,
    trunkLeanDeg = 0,
    valgusRatio = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  // Build base as a standing pose (kneeFlexionDeg=0)
  // Then shift hip and shoulder upward by hipRise
  const baseIntent: SquatPoseIntent = {
    kneeFlexionDeg: 0,        // standing straight
    feetWidthRatio,
    armsOverhead: false,      // arms at sides
    trunkLeanDeg,
    valgusRatio,
    bodyHeight,
    noise: 0,                 // apply noise after shift
    seed,
    visibility,
  };

  const pose = buildSquatPose(baseIntent);

  // Shift entire upper body up by hipRise (hip Y decreases = person goes higher in frame)
  const shiftY = hipRise;

  const upperBodyLandmarks = [
    IDX.leftShoulder, IDX.rightShoulder,
    IDX.leftElbow, IDX.rightElbow,
    IDX.leftWrist, IDX.rightWrist,
    IDX.leftHip, IDX.rightHip,
    IDX.nose,
  ];

  for (const idx of upperBodyLandmarks) {
    if (pose[idx]) pose[idx].y -= shiftY;
  }

  // Knees move up by fraction of the hip rise
  const kneeShiftY = shiftY * 0.7;
  if (pose[IDX.leftKnee]) pose[IDX.leftKnee].y -= kneeShiftY;
  if (pose[IDX.rightKnee]) pose[IDX.rightKnee].y -= kneeShiftY;

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

/**
 * Walking-Lunge pose stub â€” identical to buildLungePose.
 * Same front-camera geometry, same joint angles.
 */
export const buildWalkingLungePose = buildLungePose;

// ------------------------------------------------------------------------
// REVERSE FLY â€” front-facing, bent-over position.
//
// The user is hinged forward at ~45Â°, arms hang below shoulders.
// As armLiftDeg increases (0â†’90), wrists rise from below-shoulder to shoulder level.
//
// Key geometry (same as lateral raise but torso is bent forward):
//   bentOver=true:  shoulderMidY > hipMidY (shoulders lower in frame than hips)
//   armsHanging: wristY = shoulderY + 0.20 (below shoulders)
//   armLiftDeg=0: wristY = shoulderY + RF_ARM_L * cos(0) = shoulderY + RF_ARM_L
//   armLiftDeg=90: wristY = shoulderY + RF_ARM_L * cos(Ï€/2) = shoulderY (at shoulder level)
// ------------------------------------------------------------------------

const RF_ARM_L = 0.24; // upper arm + forearm combined in normalised coords

function revFlyArmGeom(
  shoulderX: number,
  shoulderY: number,
  liftDeg: number,
  side: 'left' | 'right',
) {
  const thetaRad = (liftDeg * Math.PI) / 180;
  const sign = side === 'left' ? -1 : 1;
  const wristX = shoulderX + sign * RF_ARM_L * Math.sin(thetaRad);
  const wristY = shoulderY + RF_ARM_L * Math.cos(thetaRad);
  const halfL = RF_ARM_L / 2;
  const elbowX = shoulderX + sign * halfL * Math.sin(thetaRad);
  const elbowY = shoulderY + halfL * Math.cos(thetaRad);
  return { wristX, wristY, elbowX, elbowY };
}

export function buildReverseFlyPose(intent: ReverseFlyPoseIntent): PoseLandmarks {
  const {
    armLiftDeg: liftDeg,
    leftArmLiftDeg,
    rightArmLiftDeg,
    bentOver = true,
    distanceOk: _distOk = true,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = 0.08; // feet hip-width

  const ankleXLeft  = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;
  const ankleY = 0.92;

  // When bent-over: hips are in the upper-middle of the frame.
  // Shoulders are slightly BELOW hips in the frame (shoulderMidY > hipMidY) because
  // the torso has hinged forward. However, the body height (ankleY - shoulderY) must
  // still be within the calibration range (0.42â€“0.92).
  //
  // With ankleY=0.92 and BODY_HEIGHT_MIN_ENTER=0.42:
  //   shoulderY must be <= 0.92 - 0.42 = 0.50 for bodyHeight >= 0.42.
  //
  // Bent-over geometry: hips at 0.40, shoulders at 0.45 (below hips â†’ +0.05 above threshold).
  // This gives bodyHeight = 0.92 - 0.45 = 0.47 âœ“ (within 0.42â€“0.92).
  // Standing: hips at 0.50, shoulders at 0.30 (above hips in normal posture).
  const hipMidX = cx;

  let hipMidY: number;
  let shoulderMidY: number;

  if (bentOver) {
    // Bent-over: hips near top-third, shoulders just below hips (bent forward)
    hipMidY = 0.40;
    shoulderMidY = hipMidY + 0.06; // shoulders 0.06 below hips in frame â†’ satisfies BENT_OVER_THRESHOLD=0.03
    // bodyHeight = ankleY - shoulderMidY = 0.92 - 0.46 = 0.46 âœ“ within [0.42, 0.92]
  } else {
    // Standing: hips at ~0.52, shoulders above at ~0.34
    hipMidY = 0.52;
    shoulderMidY = hipMidY - 0.18; // shoulders above hips (normal upright posture)
    // bodyHeight = ankleY - shoulderMidY = 0.92 - 0.34 = 0.58 âœ“
  }

  const headY = bentOver ? shoulderMidY + 0.08 : shoulderMidY - 0.10;
  const hipHalf = 0.06;

  pose[IDX.nose]     = makeLandmark(cx,          headY,        visibility);
  pose[IDX.leftEye]  = makeLandmark(cx - 0.02,   headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(cx + 0.02,   headY - 0.01, visibility);
  pose[IDX.leftEar]  = makeLandmark(cx - 0.035,  headY,        visibility);
  pose[IDX.rightEar] = makeLandmark(cx + 0.035,  headY,        visibility);

  const leftShoulderX  = cx - shoulderHalf;
  const rightShoulderX = cx + shoulderHalf;
  pose[IDX.leftShoulder]  = makeLandmark(leftShoulderX,  shoulderMidY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderMidY, visibility);
  pose[IDX.leftHip]  = makeLandmark(hipMidX - hipHalf, hipMidY, visibility);
  pose[IDX.rightHip] = makeLandmark(hipMidX + hipHalf, hipMidY, visibility);

  const leftLift  = leftArmLiftDeg  ?? liftDeg;
  const rightLift = rightArmLiftDeg ?? liftDeg;
  const leftArm  = revFlyArmGeom(leftShoulderX,  shoulderMidY, leftLift,  'left');
  const rightArm = revFlyArmGeom(rightShoulderX, shoulderMidY, rightLift, 'right');

  pose[IDX.leftElbow]  = makeLandmark(leftArm.elbowX,  leftArm.elbowY,  visibility);
  pose[IDX.rightElbow] = makeLandmark(rightArm.elbowX, rightArm.elbowY, visibility);
  pose[IDX.leftWrist]  = makeLandmark(leftArm.wristX,  leftArm.wristY,  visibility);
  pose[IDX.rightWrist] = makeLandmark(rightArm.wristX, rightArm.wristY, visibility);

  const kneeY = (hipMidY + ankleY) / 2;
  pose[IDX.leftKnee]  = makeLandmark(ankleXLeft,  kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(ankleXRight, kneeY, visibility);
  pose[IDX.leftAnkle]  = makeLandmark(ankleXLeft,  ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, ankleY, visibility);
  pose[IDX.leftHeel]   = makeLandmark(ankleXLeft  - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel]  = makeLandmark(ankleXRight + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex]  = makeLandmark(ankleXLeft  + 0.02, ankleY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, ankleY, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// ------------------------------------------------------------------------
// GOBLET SQUAT â€” front-facing, symmetric swing-out geometry (same as squat)
// + elbow spread positioning to model goblet hold.
//
// elbowSpreadRatio = elbowWidth / shoulderWidth.
//   1.0 = elbows at shoulder width (good goblet grip, elbows spread out)
//   0.5 = elbows collapsed inward
// Elbows are placed at chest height (shoulderY + 0.10) at the given spread.
// ------------------------------------------------------------------------

export function buildGobletSquatPose(intent: GobletSquatPoseIntent | null): PoseLandmarks {
  if (!intent) {
    // null intent â†’ all landmarks invisible (position-lost scenario)
    const pose = emptyPose();
    for (const lm of pose) lm.visibility = 0;
    return pose;
  }

  const {
    kneeFlexionDeg: flexDeg,
    elbowSpreadRatio = 1.0,
    feetWidthRatio = 1.25,
    heelLift = 0,
    valgusRatio = 0,
    trunkLeanDeg: trunkLean = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  const cx = 0.50;
  const baseAnkleY = 0.92;
  const ankleY = baseAnkleY - heelLift;

  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  const ankleHalf = (shoulderWidth * feetWidthRatio) / 2;
  const ankleXLeft = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;

  const left = legGeometry(ankleXLeft, ankleY, flexDeg, -1);
  const right = legGeometry(ankleXRight, ankleY, flexDeg, +1);

  const adjLeftKneeX = left.kneeX * (1 - valgusRatio) + cx * valgusRatio;
  const adjRightKneeX = right.kneeX * (1 - valgusRatio) + cx * valgusRatio;

  const hipMidX = (left.hipX + right.hipX) / 2;
  const hipMidY = (left.hipY + right.hipY) / 2;
  const torsoHeight = 0.18;

  const leanRad = (trunkLean * Math.PI) / 180;
  const shoulderY = hipMidY - torsoHeight * Math.cos(leanRad);
  const shoulderXShift = Math.sin(leanRad) * torsoHeight;

  const headY = shoulderY - 0.10;

  pose[IDX.nose] = makeLandmark(hipMidX + shoulderXShift, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(hipMidX - 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(hipMidX + 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(hipMidX - 0.035 + shoulderXShift, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(hipMidX + 0.035 + shoulderXShift, headY, visibility);

  const leftShoulderX = hipMidX - shoulderHalf + shoulderXShift;
  const rightShoulderX = hipMidX + shoulderHalf + shoulderXShift;

  pose[IDX.leftShoulder] = makeLandmark(leftShoulderX, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(rightShoulderX, shoulderY, visibility);

  // Goblet hold: elbows at chest level (shoulderY + 0.10), spread by elbowSpreadRatio
  // elbowHalf = shoulderWidth * elbowSpreadRatio / 2
  const elbowHalf = (shoulderWidth * elbowSpreadRatio) / 2;
  const elbowY = shoulderY + 0.10;
  pose[IDX.leftElbow] = makeLandmark(cx - elbowHalf, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + elbowHalf, elbowY, visibility);
  // Wrists close together at center (holding the weight)
  pose[IDX.leftWrist] = makeLandmark(cx - 0.02, elbowY + 0.06, visibility);
  pose[IDX.rightWrist] = makeLandmark(cx + 0.02, elbowY + 0.06, visibility);

  pose[IDX.leftHip] = makeLandmark(left.hipX, left.hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(right.hipX, right.hipY, visibility);

  pose[IDX.leftKnee] = makeLandmark(adjLeftKneeX, left.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(adjRightKneeX, right.kneeY, visibility);

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

// ------------------------------------------------------------------------
// DONKEY KICK â€” side-facing camera, user on all fours (quadruped).
//
// Same base geometry as bird-dog. User faces RIGHT in the frame.
// The active leg kicks UPWARD: knee moves backward and up from below the hip.
//
// Key geometry:
//   thighLiftDeg=0:  knee.y = hip.y + L_THIGH (knee directly below hip)
//   thighLiftDeg=T:  knee.x decreases (moves behind hip), knee.y decreases (moves up)
//   Ankle: shin points downward/backward â€” ankle always below and behind knee
// ------------------------------------------------------------------------

export function buildDonkeyKickPose(intent: DonkeyKickPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    // Return pose with all landmarks at zero visibility (position lost)
    const nullPoseDK = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) {
      nullPoseDK[i] = makeLandmark(0.5, 0.5, 0);
    }
    return nullPoseDK;
  }

  const {
    thighLiftDeg: liftDeg,
    bentOver = true,
    handsDown = true,
    bodySpan = 0.60,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const dkPose = emptyPose();

  // Scale factor: bodySpan controls how much of the frame width the body occupies
  const dkScale = bodySpan / 0.60;

  // Base geometry (user facing right, scale=1.0):
  // Shoulder is at camera-right (head side), hip is to the left (tail side)
  const DK_SHOULDER_X = 0.68;
  const DK_SHOULDER_Y = 0.42;
  const DK_HIP_X = 0.45;
  // Body horizontal when bentOver=true (hip same height as shoulder)
  const DK_HIP_Y = bentOver ? 0.42 : 0.30; // tilted if not bent over

  const DK_L_THIGH = 0.18; // thigh length in normalized coords
  const DK_L_SHIN  = 0.18; // shin length (knee bent ~90Â°, shin pointing down/back)

  // Thigh rotation: at liftDeg=0, knee is directly below hip.
  // As liftDeg increases, knee moves backward (away from head side) and up.
  const dkRotRad = liftDeg * Math.PI / 180;
  // In side view: backward = decreasing X (toward camera-left = behind user)
  const dkExtKneeX = DK_HIP_X - DK_L_THIGH * Math.sin(dkRotRad);
  const dkExtKneeY = DK_HIP_Y + DK_L_THIGH * Math.cos(dkRotRad);
  // Ankle: shin points backward (left in side view) to give enough body span for calibration.
  // Using DK_L_SHIN * 1.0 for X component (shin points fully left = backward at rest).
  // This gives span = |ankle.x - shoulder.x| >= 0.41, passing the 0.40 gate.
  const dkExtAnkleX = dkExtKneeX - DK_L_SHIN; // shin points left (backward)
  const dkExtAnkleY = dkExtKneeY + DK_L_SHIN * 0.3; // slightly downward

  // Wrist position: below shoulder when handsDown=true (calibration valid)
  const DK_WRIST_Y = handsDown ? DK_SHOULDER_Y + 0.32 : DK_SHOULDER_Y - 0.10;
  const DK_WRIST_X = DK_SHOULDER_X + 0.12;
  const DK_ELBOW_Y = DK_SHOULDER_Y + 0.18;
  const DK_ELBOW_X = DK_SHOULDER_X + 0.06;

  // Apply scale (scale around the shoulder point as anchor)
  const dkCx = DK_SHOULDER_X;
  function dkScaleX(x: number) { return dkCx + (x - dkCx) * dkScale; }

  // Set landmarks â€” use both left and right (engine picks whichever has higher lift)
  dkPose[IDX.leftShoulder]  = makeLandmark(dkScaleX(DK_SHOULDER_X), DK_SHOULDER_Y, visibility);
  dkPose[IDX.rightShoulder] = makeLandmark(dkScaleX(DK_SHOULDER_X), DK_SHOULDER_Y + 0.01, visibility * 0.7);
  dkPose[IDX.leftHip]       = makeLandmark(dkScaleX(DK_HIP_X),      DK_HIP_Y,      visibility);
  dkPose[IDX.rightHip]      = makeLandmark(dkScaleX(DK_HIP_X),      DK_HIP_Y + 0.01, visibility * 0.7);

  // Active (near) leg â€” left side (visible to camera in right-facing setup)
  dkPose[IDX.leftKnee]  = makeLandmark(dkScaleX(dkExtKneeX),  dkExtKneeY,  visibility);
  dkPose[IDX.leftAnkle] = makeLandmark(dkScaleX(dkExtAnkleX), dkExtAnkleY, visibility);

  // Non-active (far) leg â€” stays in quadruped rest position
  const dkRestKneeX  = DK_HIP_X;
  const dkRestKneeY  = DK_HIP_Y + DK_L_THIGH; // knee directly below hip
  const dkRestAnkleX = dkRestKneeX - DK_L_SHIN; // shin points left (backward)
  const dkRestAnkleY = dkRestKneeY + DK_L_SHIN * 0.3;
  dkPose[IDX.rightKnee]  = makeLandmark(dkScaleX(dkRestKneeX + 0.03),  dkRestKneeY,  visibility * 0.6);
  dkPose[IDX.rightAnkle] = makeLandmark(dkScaleX(dkRestAnkleX + 0.03), dkRestAnkleY, visibility * 0.6);

  // Arms â€” on floor (wrists below shoulders during calibration)
  dkPose[IDX.leftWrist]   = makeLandmark(dkScaleX(DK_WRIST_X),        DK_WRIST_Y,  visibility);
  dkPose[IDX.leftElbow]   = makeLandmark(dkScaleX(DK_ELBOW_X),        DK_ELBOW_Y,  visibility);
  dkPose[IDX.rightWrist]  = makeLandmark(dkScaleX(DK_WRIST_X - 0.35), DK_WRIST_Y,  visibility * 0.7);
  dkPose[IDX.rightElbow]  = makeLandmark(dkScaleX(DK_ELBOW_X - 0.35), DK_ELBOW_Y,  visibility * 0.7);

  dkPose[IDX.nose] = makeLandmark(dkScaleX(0.85), 0.22, visibility);

  applyOcclusion(dkPose, occludedIndices);
  return dkPose;
}

// ------------------------------------------------------------------------
// FIRE HYDRANT â€” side-facing camera, user on all fours (quadruped).
//
// Identical base geometry to donkey-kick. The fire hydrant lifts the knee
// LATERALLY (out to the side), but from the 2D side camera, the observable
// signal is the same: the knee rises above the hip. thighLiftDeg is computed
// as the angle of the hipâ†’knee vector from "pointing straight down" (0Â°).
//   thighLiftDeg=0:  knee.y = hip.y + L_THIGH (knee directly below hip)
//   thighLiftDeg=T:  knee moves outward and up (here: backward in side view)
// ------------------------------------------------------------------------

export function buildFireHydrantPose(intent: FireHydrantPoseIntent | null): PoseLandmarks {
  if (intent === null) {
    const nullPose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) nullPose[i] = makeLandmark(0.5, 0.5, 0);
    return nullPose;
  }

  const {
    thighLiftDeg: liftDeg,
    bentOver = true,
    handsDown = true,
    bodySpan = 0.60,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const fhPose = emptyPose();

  const fhScale = bodySpan / 0.60;

  const FH_SHOULDER_X = 0.68;
  const FH_SHOULDER_Y = 0.42;
  const FH_HIP_X = 0.45;
  const FH_HIP_Y = bentOver ? 0.42 : 0.30;

  const FH_L_THIGH = 0.18;
  const FH_L_SHIN  = 0.18;

  const fhRotRad = liftDeg * Math.PI / 180;
  const fhExtKneeX = FH_HIP_X - FH_L_THIGH * Math.sin(fhRotRad);
  const fhExtKneeY = FH_HIP_Y + FH_L_THIGH * Math.cos(fhRotRad);
  const fhExtAnkleX = fhExtKneeX - FH_L_SHIN;
  const fhExtAnkleY = fhExtKneeY + FH_L_SHIN * 0.3;

  const FH_WRIST_Y = handsDown ? FH_SHOULDER_Y + 0.32 : FH_SHOULDER_Y - 0.10;
  const FH_WRIST_X = FH_SHOULDER_X + 0.12;
  const FH_ELBOW_Y = FH_SHOULDER_Y + 0.18;
  const FH_ELBOW_X = FH_SHOULDER_X + 0.06;

  const fhCx = FH_SHOULDER_X;
  function fhScaleX(x: number) { return fhCx + (x - fhCx) * fhScale; }

  fhPose[IDX.leftShoulder]  = makeLandmark(fhScaleX(FH_SHOULDER_X), FH_SHOULDER_Y, visibility);
  fhPose[IDX.rightShoulder] = makeLandmark(fhScaleX(FH_SHOULDER_X), FH_SHOULDER_Y + 0.01, visibility * 0.7);
  fhPose[IDX.leftHip]       = makeLandmark(fhScaleX(FH_HIP_X),      FH_HIP_Y,      visibility);
  fhPose[IDX.rightHip]      = makeLandmark(fhScaleX(FH_HIP_X),      FH_HIP_Y + 0.01, visibility * 0.7);

  // Active (near) leg â€” left side (visible to camera)
  fhPose[IDX.leftKnee]  = makeLandmark(fhScaleX(fhExtKneeX),  fhExtKneeY,  visibility);
  fhPose[IDX.leftAnkle] = makeLandmark(fhScaleX(fhExtAnkleX), fhExtAnkleY, visibility);

  // Non-active (far) leg â€” stays in quadruped rest
  const fhRestKneeX  = FH_HIP_X;
  const fhRestKneeY  = FH_HIP_Y + FH_L_THIGH;
  const fhRestAnkleX = fhRestKneeX - FH_L_SHIN;
  const fhRestAnkleY = fhRestKneeY + FH_L_SHIN * 0.3;
  fhPose[IDX.rightKnee]  = makeLandmark(fhScaleX(fhRestKneeX + 0.03),  fhRestKneeY,  visibility * 0.6);
  fhPose[IDX.rightAnkle] = makeLandmark(fhScaleX(fhRestAnkleX + 0.03), fhRestAnkleY, visibility * 0.6);

  // Arms â€” on floor
  fhPose[IDX.leftWrist]   = makeLandmark(fhScaleX(FH_WRIST_X),        FH_WRIST_Y,  visibility);
  fhPose[IDX.leftElbow]   = makeLandmark(fhScaleX(FH_ELBOW_X),        FH_ELBOW_Y,  visibility);
  fhPose[IDX.rightWrist]  = makeLandmark(fhScaleX(FH_WRIST_X - 0.35), FH_WRIST_Y,  visibility * 0.7);
  fhPose[IDX.rightElbow]  = makeLandmark(fhScaleX(FH_ELBOW_X - 0.35), FH_ELBOW_Y,  visibility * 0.7);

  fhPose[IDX.nose] = makeLandmark(fhScaleX(0.85), 0.22, visibility);

  applyOcclusion(fhPose, occludedIndices);
  return fhPose;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CURTSY LUNGE â€” front camera, standing, one knee bends with rear ankle crossover
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Build a curtsy-lunge pose from intent.
 *
 * Key geometry:
 *   - Front (active/standing) leg bends to kneeFlexionDeg (170 = straight, 90 = deep)
 *   - Rear ankle crosses behind front ankle by crossoverRatio Ã— hipWidth
 *   - We always put the left leg as front for simplicity (engine detects the more-bent leg)
 *   - feetWidth â‰ˆ 0.85Ã— hipWidth so the feetWide gate passes (0.7â€“1.4Ã— hip ratio)
 */
export function buildCurtsyLungePose(intent: CurtsyLungePoseIntent): PoseLandmarks {
  const {
    kneeFlexionDeg,
    crossoverRatio = 0,
    trunkLeanDeg = 0,
    hipRotationRatio,
    hipRotation,
    kneeValgusRatio = 0,
    bodyHeight = 0.638,
    armsRaised = false,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
    isNull,
  } = intent;
  const effectiveHipRotationRatio = hipRotation ?? hipRotationRatio ?? 0;

  if (isNull) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i] = makeLandmark(0.5, 0.5, 0);
    return pose;
  }

  const pose = emptyPose();

  const cx = 0.50;
  const ankleY = 0.92;
  const hipWidth = 0.14;   // hip-width in normalized coords
  const hipHalf = hipWidth / 2;
  // feet hip-width (ratio 1.0 Ã— hipWidth â€” easily within 0.7â€“1.4 gate)
  const feetHalf = hipHalf;

  const leftAnkleX = cx - feetHalf;
  const rightAnkleX = cx + feetHalf;

  // bodyHeight controls the shoulder-to-ankle span for calibration distance gate
  // Calibration: bodyHeight = |ankleY - shoulderY|
  // We scale the whole body so that shoulderY = ankleY - bodyHeight
  const targetShoulderY = ankleY - bodyHeight;

  // Front (left) leg: bends to kneeFlexionDeg (joint angle, 180=straight, 90=deep curtsy).
  // Uses sign=-1: knee swings LEFT (outward) for normal curtsy geometry.
  const L = 0.22;
  const flexDeg = 180 - kneeFlexionDeg;  // 0 = straight, 90 = deep
  const leftLeg = legGeometry(leftAnkleX, ankleY, flexDeg, -1);

  // Valgus encoding: when valgusRatio > 0, place knee to the RIGHT of ankle (absolute target).
  // This makes the knee appear "inside" of the ankle (valgus). The kneeY stays from legGeometry.
  // At ankle=0.43: target kneeX = 0.43 + valgusRatio*0.16. At ratio=0.25: 0.43+0.04=0.47.
  // This gives computed angle â‰ˆ 153Â° at 90Â° depth (< 155Â° â†’ DESCENDING state = inActiveRep)
  // and â‰ˆ 169Â° at 165Â° depth (> 155Â° â†’ STANDING state = gated, frontLeg=null â†’ returns false).
  // At ratio=0: uses natural legGeometry.kneeX (no angle distortion).
  const leftKneeX = kneeValgusRatio > 0
    ? leftAnkleX + kneeValgusRatio * 0.16
    : leftLeg.kneeX;
  const leftKneeY = leftLeg.kneeY;
  const leftHipX = leftLeg.hipX;
  const leftHipY = leftLeg.hipY;

  // Rear (right) leg:
  // - At crossoverRatio=0 (calibration/standing): right ankle at normal position (cx+feetHalf)
  //   This ensures feetWidth = 2*feetHalf = hipWidth â†’ feetWide gate passes (ratio = 1.0)
  // - At crossoverRatio>0 (active curtsy): rear ankle crosses past front ankle
  //   engine_crossover = (leftAnkle.x - rearAnkle.x) / baseline.hipWidth = crossoverRatio
  //   â†’ rearAnkleX = leftAnkleX - crossoverRatio * hipWidth
  const rearAnkleX = crossoverRatio > 0
    ? leftAnkleX - crossoverRatio * hipWidth   // crossing phase: encodes crossoverRatio exactly
    : cx + feetHalf;                           // standing: feet at normal hip-width apart
  const rearKneeX = cx + feetHalf * 0.5;
  const rearKneeY = ankleY - L * 0.95;
  const rightHipX = cx + feetHalf;
  // Hip rotation: rear hip rises (smaller Y). Use bodyHeight*0.30 as torso estimate for scaling.
  const torsoHeightApprox = bodyHeight * 0.30;
  const rightHipY = leftHipY - (effectiveHipRotationRatio * torsoHeightApprox);  // rises = smaller Y

  const hipMidX = (leftHipX + rightHipX) / 2;
  const hipMidY = (leftHipY + rightHipY) / 2;
  // Torso height = distance from hip to shoulder, scaled so that shoulder lands at targetShoulderY
  const torsoHeight = hipMidY - targetShoulderY;

  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderY = hipMidY - torsoHeight * Math.cos(leanRad);
  const shoulderXShift = Math.sin(leanRad) * torsoHeight;
  const shoulderHalf = 0.10;

  const headY = shoulderY - 0.08;

  pose[IDX.nose]       = makeLandmark(cx + shoulderXShift, headY,          visibility);
  pose[IDX.leftEye]    = makeLandmark(cx - 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.rightEye]   = makeLandmark(cx + 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.leftEar]    = makeLandmark(cx - 0.03 + shoulderXShift, headY,    visibility);
  pose[IDX.rightEar]   = makeLandmark(cx + 0.03 + shoulderXShift, headY,    visibility);

  pose[IDX.leftShoulder]  = makeLandmark(cx - shoulderHalf + shoulderXShift, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf + shoulderXShift, shoulderY, visibility);

  // Arms: relaxed at sides (wrists below hips) or raised overhead (fails calibration gate)
  const wristY = armsRaised ? shoulderY - 0.18 : hipMidY + 0.08;
  const elbowY = armsRaised ? shoulderY - 0.08 : shoulderY + 0.08;
  pose[IDX.leftElbow]  = makeLandmark(cx - shoulderHalf - 0.01, elbowY, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + shoulderHalf + 0.01, elbowY, visibility);
  pose[IDX.leftWrist]  = makeLandmark(cx - shoulderHalf - 0.01, wristY, visibility);
  pose[IDX.rightWrist] = makeLandmark(cx + shoulderHalf + 0.01, wristY, visibility);

  pose[IDX.leftHip]  = makeLandmark(leftHipX,  leftHipY,  visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, rightHipY, visibility);

  pose[IDX.leftKnee]  = makeLandmark(leftKneeX,  leftKneeY,  visibility);
  pose[IDX.rightKnee] = makeLandmark(rearKneeX,  rearKneeY,  visibility);

  pose[IDX.leftAnkle]  = makeLandmark(leftAnkleX, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(rearAnkleX, ankleY, visibility);

  pose[IDX.leftHeel]      = makeLandmark(leftAnkleX - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel]     = makeLandmark(rearAnkleX - 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(leftAnkleX + 0.02,  ankleY,        visibility);
  pose[IDX.rightFootIndex]= makeLandmark(rearAnkleX + 0.02,  ankleY,        visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PALLOF PRESS â€” front camera, standing, arms press out from chest
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Build a pallof-press pose from intent.
 * elbowExtensionDeg: 90 = hands at chest, 165 = arms fully extended.
 * The engine computes elbow angle from shoulder-elbow-wrist triangle.
 */
export function buildPallofPressPose(intent: PallofPressPoseIntent): PoseLandmarks {
  const {
    elbowExtensionDeg,
    torsoRotationDeg = 0,
    shoulderShrug: _shoulderShrug = 0,
    visibility = 0.95,
    isNull,
  } = intent;

  if (isNull) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i] = makeLandmark(0.5, 0.5, 0);
    return pose;
  }

  const pose = emptyPose();
  const cx = 0.50;
  const shoulderY = 0.30;
  const ankleY = 0.90;
  const hipY = 0.56;
  const shoulderHalf = 0.10;

  // Torso rotation: shift left vs right shoulder Y slightly
  const rotRad = (torsoRotationDeg * Math.PI) / 180;
  const shoulderYDelta = Math.sin(rotRad) * 0.03;

  pose[IDX.nose]       = makeLandmark(cx, shoulderY - 0.10, visibility);
  pose[IDX.leftEye]    = makeLandmark(cx - 0.02, shoulderY - 0.11, visibility);
  pose[IDX.rightEye]   = makeLandmark(cx + 0.02, shoulderY - 0.11, visibility);
  pose[IDX.leftEar]    = makeLandmark(cx - 0.03, shoulderY - 0.10, visibility);
  pose[IDX.rightEar]   = makeLandmark(cx + 0.03, shoulderY - 0.10, visibility);

  pose[IDX.leftShoulder]  = makeLandmark(cx - shoulderHalf, shoulderY - shoulderYDelta, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf, shoulderY + shoulderYDelta, visibility);

  // Arms: elbow + wrist positioned so shoulder-elbow-wrist angle = elbowExtensionDeg
  // Arms extend forward (in the horizontal plane visible as horizontal in 2D front view)
  const extRad = (elbowExtensionDeg * Math.PI) / 180;
  const armSegLen = 0.10;  // upper arm and forearm each 0.10 units

  // Left arm: shoulder at (cx - 0.10, shoulderY), elbow extends rightward then wrist further
  const leftShoulderX = cx - shoulderHalf;
  const leftElbowX = leftShoulderX + armSegLen;
  const leftElbowY = shoulderY + 0.02;
  // wrist extends from elbow at elbowExtensionDeg angle from elbow perspective
  const leftWristX = leftElbowX + armSegLen * Math.cos(extRad - Math.PI);
  const leftWristY = leftElbowY + armSegLen * Math.sin(extRad - Math.PI) * 0.1;

  const rightShoulderX = cx + shoulderHalf;
  const rightElbowX = rightShoulderX - armSegLen;
  const rightElbowY = shoulderY + 0.02;
  const rightWristX = rightElbowX - armSegLen * Math.cos(extRad - Math.PI);
  const rightWristY = rightElbowY + armSegLen * Math.sin(extRad - Math.PI) * 0.1;

  pose[IDX.leftElbow]  = makeLandmark(leftElbowX,  leftElbowY,  visibility);
  pose[IDX.rightElbow] = makeLandmark(rightElbowX, rightElbowY, visibility);
  pose[IDX.leftWrist]  = makeLandmark(leftWristX,  leftWristY,  visibility);
  pose[IDX.rightWrist] = makeLandmark(rightWristX, rightWristY, visibility);

  pose[IDX.leftHip]  = makeLandmark(cx - 0.07, hipY, visibility);
  pose[IDX.rightHip] = makeLandmark(cx + 0.07, hipY, visibility);

  pose[IDX.leftKnee]  = makeLandmark(cx - 0.07, 0.72, visibility);
  pose[IDX.rightKnee] = makeLandmark(cx + 0.07, 0.72, visibility);

  pose[IDX.leftAnkle]  = makeLandmark(cx - 0.07, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(cx + 0.07, ankleY, visibility);

  pose[IDX.leftHeel]      = makeLandmark(cx - 0.075, ankleY + 0.01, visibility);
  pose[IDX.rightHeel]     = makeLandmark(cx + 0.075, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(cx - 0.065, ankleY,        visibility);
  pose[IDX.rightFootIndex]= makeLandmark(cx + 0.065, ankleY,        visibility);

  return pose;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LATERAL BAND WALK â€” front camera, standing, hip shifts laterally
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Build a lateral-band-walk pose from intent.
 * hipXDisplacement: normalized lateral shift relative to center.
 *   0 = centered (calibration position)
 *   > 0 = shifted right
 *   < 0 = shifted left
 * The engine computes displacement relative to the baseline hipMid.x captured at calibration.
 * So at calibration we put hipMid.x = 0.50, and during stepping hipMid.x shifts by
 * hipXDisplacement Ã— shoulderWidth (engine normalizes by shoulderWidth).
 */
export function buildLateralBandWalkPose(intent: LateralBandWalkPoseIntent): PoseLandmarks {
  const {
    hipXDisplacement,
    trunkLeanDeg = 0,
    hipDropRatio = 0,
    bodyHeight = 0.70,
    isNearEdge = false,
    visibility = 0.95,
    isNull,
    walkingAnkleRaise = 0, // BUG-LBW-11: 0 = both feet on floor (default)
  } = intent;

  if (isNull) {
    const pose = emptyPose();
    for (let i = 0; i < LM_COUNT; i++) pose[i] = makeLandmark(0.5, 0.5, 0);
    return pose;
  }

  const pose = emptyPose();
  const cx = 0.50;
  const shoulderWidth = 0.18;   // shoulderWidth used in baseline capture
  const shoulderHalf = shoulderWidth / 2;
  // Scale body to match bodyHeight â€” use bodyHeight to set the ankle-shoulder span
  // bodyHeight = ankleY - shoulderY, so shoulderY = ankleY - bodyHeight
  const ankleY = 0.92;
  const shoulderY = ankleY - bodyHeight;
  const hipY = shoulderY + bodyHeight * 0.38;
  const torsoHeight = hipY - shoulderY;

  // Shift hips laterally: hipXDisplacement is normalized by shoulderWidth
  // engine computes: displacement = (currentHipX - baseline.hipMid.x) / baseline.shoulderWidth
  // So if baseline.hipMid.x = cx and baseline.shoulderWidth = shoulderWidth:
  // hipXDisplacement = (cx + shift - cx) / shoulderWidth âŸ¹ shift = hipXDisplacement * shoulderWidth
  // isNearEdge=true: place hip X very near the left frame edge (< 0.08) to trigger steps-not-tracked
  const hipShift = isNearEdge ? (0.04 - cx) : (hipXDisplacement * shoulderWidth);

  // Trunk lean: shift shoulders slightly opposite to hip shift for lean simulation
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const shoulderShift = Math.sin(leanRad) * torsoHeight;

  // Hip drop: the stepping-side hip drops (Y increases = lower in frame).
  // detectHipDrop checks: steppingHipY - baselineHipY > threshold * torsoHeight.
  // Stepping right (hipShift > 0): right hip drops (Y increases).
  // Stepping left (hipShift < 0): left hip drops (Y increases).
  const hipDropDelta = hipDropRatio * torsoHeight;
  const leftHipYAdj  = hipShift < 0 ? hipY + hipDropDelta : hipY;
  const rightHipYAdj = hipShift >= 0 ? hipY + hipDropDelta : hipY;

  pose[IDX.nose]       = makeLandmark(cx + shoulderShift, shoulderY - 0.10, visibility);
  pose[IDX.leftEye]    = makeLandmark(cx + shoulderShift - 0.02, shoulderY - 0.11, visibility);
  pose[IDX.rightEye]   = makeLandmark(cx + shoulderShift + 0.02, shoulderY - 0.11, visibility);
  pose[IDX.leftEar]    = makeLandmark(cx + shoulderShift - 0.03, shoulderY - 0.10, visibility);
  pose[IDX.rightEar]   = makeLandmark(cx + shoulderShift + 0.03, shoulderY - 0.10, visibility);

  pose[IDX.leftShoulder]  = makeLandmark(cx - shoulderHalf + shoulderShift, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(cx + shoulderHalf + shoulderShift, shoulderY, visibility);

  // Wrists near hips (calibration: within Â±0.08 of hipMidY)
  const hipMidY = (leftHipYAdj + rightHipYAdj) / 2;
  pose[IDX.leftElbow]  = makeLandmark(cx - shoulderHalf + hipShift * 0.3, hipMidY - 0.04, visibility);
  pose[IDX.rightElbow] = makeLandmark(cx + shoulderHalf + hipShift * 0.3, hipMidY - 0.04, visibility);
  pose[IDX.leftWrist]  = makeLandmark(cx - shoulderHalf * 0.7 + hipShift * 0.3, hipMidY + 0.02, visibility);
  pose[IDX.rightWrist] = makeLandmark(cx + shoulderHalf * 0.7 + hipShift * 0.3, hipMidY + 0.02, visibility);

  pose[IDX.leftHip]  = makeLandmark(cx - shoulderHalf * 0.6 + hipShift, leftHipYAdj,  visibility);
  pose[IDX.rightHip] = makeLandmark(cx + shoulderHalf * 0.6 + hipShift, rightHipYAdj, visibility);

  pose[IDX.leftKnee]  = makeLandmark(cx - shoulderHalf * 0.6 + hipShift * 0.5, 0.72, visibility);
  pose[IDX.rightKnee] = makeLandmark(cx + shoulderHalf * 0.6 + hipShift * 0.5, 0.72, visibility);

  // BUG-LBW-11: walkingAnkleRaise lifts the right ankle to simulate forward walking.
  // Raising the ankle = decreasing Y (moves up in frame). Both feet on floor â†’ raise = 0.
  pose[IDX.leftAnkle]  = makeLandmark(cx - shoulderHalf * 0.6, ankleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(cx + shoulderHalf * 0.6, ankleY - walkingAnkleRaise, visibility);

  pose[IDX.leftHeel]      = makeLandmark(cx - shoulderHalf * 0.6 - 0.005, ankleY + 0.01, visibility);
  pose[IDX.rightHeel]     = makeLandmark(cx + shoulderHalf * 0.6 + 0.005, ankleY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(cx - shoulderHalf * 0.6 + 0.02,  ankleY,        visibility);
  pose[IDX.rightFootIndex]= makeLandmark(cx + shoulderHalf * 0.6 - 0.02,  ankleY,        visibility);

  return pose;
}

// â”€â”€â”€ Pistol Squat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Front-facing unilateral squat. Standing leg bends deeply; floating leg
// extends forward with ankle lifted off the ground.
//
// bodyHeight: ankle-to-shoulder Y span (0.45â€“0.92 for valid distance gate).
//   Default 0.70 (medium distance). Set < 0.45 to simulate too-far, > 0.92 for too-close.
// valgusRatio: 0 = natural, 0.25+ = standing knee collapsed inward toward ankle.
//   At high flex, the knee swings outward; valgusRatio pulls it back toward the
//   standing ankle X, simulating knee valgus. The engine detects valgus when
//   the standing knee crosses inward past the ankle's lateral position.
export function buildPistolSquatPose(intent: import('./types').PistolSquatPoseIntent): PoseLandmarks {
  const {
    kneeFlexionDeg,
    standingLeg = 'left',
    floatingLegFlexDeg = 20,
    armsForward = true,
    trunkLeanDeg: trunkLean = 0,
    valgusRatio = 0,
    bodyHeight = 0.70,
    noise = 0,
    seed = 1,
    visibility = 0.95,
    occludedIndices,
  } = intent;

  const pose = emptyPose();

  // Scale the body geometry to honour the bodyHeight intent.
  // bodyHeight = ankle-to-shoulder vertical span. We place ankles at a fixed Y
  // and derive shoulder position from bodyHeight (like broad-jump does).
  const cx = 0.50;
  const ankleY = 0.92;
  // Natural body height at L=0.22 with 0Â° flex: legLen=0.44, torso=0.18 â†’ spanâ‰ˆ0.62.
  // We scale the effective leg length proportionally so bodyHeight is respected.
  const naturalBodyHeight = 0.62;
  const scale = bodyHeight / naturalBodyHeight;
  const effectiveL = L * scale;
  const effectiveTorso = 0.18 * scale;

  const shoulderWidth = 0.16;
  const shoulderHalf = shoulderWidth / 2;
  // Narrow foot placement â€” one foot planted, the other extended
  const ankleHalf = shoulderWidth * 0.40;
  const ankleXLeft = cx - ankleHalf;
  const ankleXRight = cx + ankleHalf;

  // Use a scaled legGeometry inline for pistol squat
  function scaledLegGeometry(ankleXp: number, ankleYp: number, flexDeg: number, sign: -1 | 1) {
    const halfRad = (flexDeg / 2) * Math.PI / 180;
    const baseLen = 2 * effectiveL * Math.cos(halfRad);
    const offset = effectiveL * Math.sin(halfRad);
    const hipXp = ankleXp;
    const hipYp = ankleYp - baseLen;
    const midYp = ankleYp - baseLen / 2;
    const kneeXp = ankleXp + sign * offset;
    const kneeYp = midYp;
    return { kneeX: kneeXp, kneeY: kneeYp, hipX: hipXp, hipY: hipYp };
  }

  const standingFlex = kneeFlexionDeg;
  const floatingFlex = floatingLegFlexDeg;

  const standingSign: -1 | 1 = standingLeg === 'left' ? -1 : 1;
  const floatingSign: -1 | 1 = standingLeg === 'left' ? 1 : -1;

  const standingAnkleX = standingLeg === 'left' ? ankleXLeft : ankleXRight;
  const floatingAnkleX = standingLeg === 'left' ? ankleXRight : ankleXLeft;

  // Standing ankle stays on the ground; floating ankle is lifted proportionally
  // to the standing knee flex. At 0Â° (calibration/standing), both ankles are
  // at the same Y so the feetOnGround calibration gate passes.
  const standingAnkleY = ankleY;
  const floatingAnkleY = standingAnkleY - (standingFlex / 90) * bodyHeight * 0.08;

  const standingLeg_ = scaledLegGeometry(standingAnkleX, standingAnkleY, standingFlex, standingSign);
  const floatingLeg_ = scaledLegGeometry(floatingAnkleX, floatingAnkleY, floatingFlex, floatingSign);

  // Valgus: place the standing knee INWARD of the standing ankle.
  // When valgusRatio > 0, the knee is shifted past the ankle's lateral position
  // toward the body midline. This creates a negative outreach (ankle.x - knee.x
  // for left = outward) which the engine reliably detects as valgus.
  // valgusRatio=0 â†’ natural position; valgusRatio=0.25 â†’ knee 25% of ankleHalf inward of ankle.
  const naturalStandingKneeX = standingLeg_.kneeX;
  // For left leg (standingSign=-1): move rightward (inward) = increase X.
  // For right leg (standingSign=+1): move leftward (inward) = decrease X.
  const adjStandingKneeX = valgusRatio > 0
    ? standingAnkleX - standingSign * valgusRatio * ankleHalf  // place inward of ankle
    : naturalStandingKneeX;

  const adjLeftKneeX = standingLeg === 'left' ? adjStandingKneeX : floatingLeg_.kneeX;
  const adjRightKneeX = standingLeg === 'right' ? adjStandingKneeX : floatingLeg_.kneeX;

  // Hip midpoint: average of both hips
  const leftHipY = standingLeg === 'left' ? standingLeg_.hipY : floatingLeg_.hipY;
  const rightHipY = standingLeg === 'right' ? standingLeg_.hipY : floatingLeg_.hipY;
  const leftHipX = standingLeg === 'left' ? standingLeg_.hipX : floatingLeg_.hipX;
  const rightHipX = standingLeg === 'right' ? standingLeg_.hipX : floatingLeg_.hipX;

  const hipMidX = (leftHipX + rightHipX) / 2;
  const hipMidY = (leftHipY + rightHipY) / 2;

  const leanRad = (trunkLean * Math.PI) / 180;
  const shoulderY = hipMidY - effectiveTorso * Math.cos(leanRad);
  const shoulderXShift = Math.sin(leanRad) * effectiveTorso;

  const headY = shoulderY - 0.10 * scale;

  pose[IDX.nose] = makeLandmark(hipMidX + shoulderXShift, headY, visibility);
  pose[IDX.leftEye] = makeLandmark(hipMidX - 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.rightEye] = makeLandmark(hipMidX + 0.02 + shoulderXShift, headY - 0.01, visibility);
  pose[IDX.leftEar] = makeLandmark(hipMidX - 0.035 + shoulderXShift, headY, visibility);
  pose[IDX.rightEar] = makeLandmark(hipMidX + 0.035 + shoulderXShift, headY, visibility);

  pose[IDX.leftShoulder] = makeLandmark(hipMidX - shoulderHalf + shoulderXShift, shoulderY, visibility);
  pose[IDX.rightShoulder] = makeLandmark(hipMidX + shoulderHalf + shoulderXShift, shoulderY, visibility);

  // Arms: forward for counterbalance (pistol squat) or at sides
  if (armsForward) {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.05, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.05, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.10, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.10, visibility);
  } else {
    pose[IDX.leftElbow] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.10, visibility);
    pose[IDX.rightElbow] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.10, visibility);
    pose[IDX.leftWrist] = makeLandmark(hipMidX - shoulderHalf - 0.01, shoulderY + 0.18, visibility);
    pose[IDX.rightWrist] = makeLandmark(hipMidX + shoulderHalf + 0.01, shoulderY + 0.18, visibility);
  }

  pose[IDX.leftHip] = makeLandmark(leftHipX, leftHipY, visibility);
  pose[IDX.rightHip] = makeLandmark(rightHipX, rightHipY, visibility);

  pose[IDX.leftKnee] = makeLandmark(adjLeftKneeX, standingLeg === 'left' ? standingLeg_.kneeY : floatingLeg_.kneeY, visibility);
  pose[IDX.rightKnee] = makeLandmark(adjRightKneeX, standingLeg === 'right' ? standingLeg_.kneeY : floatingLeg_.kneeY, visibility);

  pose[IDX.leftAnkle] = makeLandmark(ankleXLeft, standingLeg === 'left' ? standingAnkleY : floatingAnkleY, visibility);
  pose[IDX.rightAnkle] = makeLandmark(ankleXRight, standingLeg === 'right' ? standingAnkleY : floatingAnkleY, visibility);

  const leftAY = standingLeg === 'left' ? standingAnkleY : floatingAnkleY;
  const rightAY = standingLeg === 'right' ? standingAnkleY : floatingAnkleY;
  pose[IDX.leftHeel] = makeLandmark(ankleXLeft - 0.005, leftAY + 0.01, visibility);
  pose[IDX.rightHeel] = makeLandmark(ankleXRight + 0.005, rightAY + 0.01, visibility);
  pose[IDX.leftFootIndex] = makeLandmark(ankleXLeft + 0.02, leftAY, visibility);
  pose[IDX.rightFootIndex] = makeLandmark(ankleXRight - 0.02, rightAY, visibility);

  applyNoise(pose, noise, seed);
  applyOcclusion(pose, occludedIndices);
  return pose;
}

// â”€â”€â”€ Nordic Curl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Side-camera kneeling geometry. Person faces camera-right (right side visible).
// As trunkLeanDeg increases, the shoulder moves forward (horizontally) while
// the hip and knee remain fixed.
export function buildNordicCurlPose(intent: import('./types').NordicCurlPoseIntent): import('@/modules/pose/types').PoseLandmarks {
  const bh = intent.bodyHeight ?? 0.60;
  const frameTopY = 0.5 - bh / 2; // center the body vertically
  const leanRad = (intent.trunkLeanDeg * Math.PI) / 180;

  // Side profile: use RIGHT side landmarks (left side has low visibility)
  // Person kneeling: ankle on floor, knee above ankle, hip above knee, shoulder above hip
  const torsoLen = bh * 0.40;  // torso is 40% of visible body height
  const thighLen = bh * 0.30;  // thigh (knee to hip) is 30%
  const shankLen = bh * 0.30;  // shin (ankle to knee)

  const ankleY = frameTopY + bh;
  const ankleX = 0.50;
  const kneeX = ankleX;
  const kneeY = ankleY - shankLen;
  const hipX = kneeX;
  const hipY = kneeY - thighLen;
  // Shoulder moves forward with trunk lean:
  const shoulderX = hipX + torsoLen * Math.sin(leanRad);
  const shoulderY = hipY - torsoLen * Math.cos(leanRad);

  const lms = emptyPose();
  const vis = intent.visibility ?? 0.95;

  // Right side (camera-facing):
  lms[IDX.rightShoulder] = makeLandmark(shoulderX, shoulderY, vis);
  lms[IDX.rightHip] = makeLandmark(hipX, hipY, vis);
  lms[IDX.rightKnee] = makeLandmark(kneeX, kneeY, vis);
  lms[IDX.rightAnkle] = makeLandmark(ankleX, ankleY, vis);
  // Left side (away from camera â€” low visibility):
  lms[IDX.leftShoulder] = makeLandmark(shoulderX + 0.05, shoulderY, 0.2);
  lms[IDX.leftHip] = makeLandmark(hipX + 0.05, hipY, 0.2);
  lms[IDX.leftKnee] = makeLandmark(kneeX + 0.05, kneeY, 0.2);
  lms[IDX.leftAnkle] = makeLandmark(ankleX + 0.05, ankleY, 0.2);
  // Nose at shoulder level for body height detection:
  lms[IDX.nose] = makeLandmark(shoulderX, shoulderY - 0.05, vis);

  applyNoise(lms, intent.noise ?? 0, intent.seed ?? 0);
  applyOcclusion(lms, intent.occludedIndices);
  return lms;
}

// â”€â”€â”€ REAL: Clamshell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Person lying on their side. Camera sees them from the side.
// Body axis is HORIZONTAL in frame; both hips at different Y positions.
// Top knee rises upward (Y decreasing) as abductionFrac increases.
export function buildClamshellPose(intent: import('./types').ClamshellPoseIntent): import('@/modules/pose/types').PoseLandmarks {
  const sideDown = intent.sideDown ?? 'left';
  const abducFrac = Math.max(0, intent.abductionFrac);
  const vis = intent.visibility ?? 0.95;

  // Body is horizontal. Place at center of frame.
  const centerX = 0.50;
  const centerY = 0.50;

  // Hip positions (stacked â€” small vertical separation = hipThickness)
  const hipThickness = 0.08;   // how far apart the two hips are vertically
  const bottomHipY = centerY + hipThickness / 2;
  const topHipY = centerY - hipThickness / 2;
  const hipX = centerX;

  // Thigh direction: knees bend forward
  const kneeBend = intent.kneeBendDeg ?? 45;
  const thighLen = 0.15;  // normalized units
  const shinLen = 0.12;
  const kneeBendRad = (kneeBend * Math.PI) / 180;

  // Bottom leg (on floor):
  const bottomKneeX = hipX + thighLen * Math.cos(kneeBendRad / 2);
  const bottomKneeY = bottomHipY + thighLen * Math.sin(kneeBendRad / 2) * 0.3;
  const bottomAnkleX = bottomKneeX + shinLen * Math.cos(kneeBendRad);
  const bottomAnkleY = bottomKneeY + shinLen * Math.sin(kneeBendRad) * 0.3;

  // Top leg at rest (closed):
  // When closed: top knee Y â‰ˆ bottom knee Y (stacked). kneeGapBaseline = small positive.
  const kneeSeparation = hipThickness * 0.80;  // small natural separation when closed
  const closedTopKneeY = bottomKneeY - kneeSeparation;
  // When open: top knee rises by abductionFrac * hipThickness
  const topKneeRise = abducFrac * hipThickness;
  const topKneeY = closedTopKneeY - topKneeRise;
  const topKneeX = bottomKneeX;  // X stays roughly same

  // Top ankle tracks with knee
  const topAnkleX = bottomAnkleX;
  const topAnkleY = bottomAnkleY - kneeSeparation - topKneeRise;

  // Build 33-landmark array
  const pose = emptyPose();

  if (sideDown === 'left') {
    // LEFT side is on floor (bottom)
    pose[IDX.leftHip]    = makeLandmark(hipX, bottomHipY, vis);
    pose[IDX.rightHip]   = makeLandmark(hipX, topHipY, vis);
    pose[IDX.leftKnee]   = makeLandmark(bottomKneeX, bottomKneeY, vis);
    pose[IDX.rightKnee]  = makeLandmark(topKneeX, topKneeY, vis);
    pose[IDX.leftAnkle]  = makeLandmark(bottomAnkleX, bottomAnkleY, vis);
    pose[IDX.rightAnkle] = makeLandmark(topAnkleX, topAnkleY, vis);
  } else {
    // RIGHT side is on floor (bottom)
    pose[IDX.rightHip]   = makeLandmark(hipX, bottomHipY, vis);
    pose[IDX.leftHip]    = makeLandmark(hipX, topHipY, vis);
    pose[IDX.rightKnee]  = makeLandmark(bottomKneeX, bottomKneeY, vis);
    pose[IDX.leftKnee]   = makeLandmark(topKneeX, topKneeY, vis);
    pose[IDX.rightAnkle] = makeLandmark(bottomAnkleX, bottomAnkleY, vis);
    pose[IDX.leftAnkle]  = makeLandmark(topAnkleX, topAnkleY, vis);
  }

  // Shoulder (horizontal, beside hip):
  const shoulderX = hipX - 0.25;  // shoulders to the left of hips
  pose[IDX.leftShoulder]  = makeLandmark(shoulderX, bottomHipY + 0.02, vis * 0.8);
  pose[IDX.rightShoulder] = makeLandmark(shoulderX, topHipY - 0.02, vis * 0.8);
  pose[IDX.nose] = makeLandmark(shoulderX - 0.05, centerY, vis * 0.6);

  applyNoise(pose, intent.noise ?? 0, intent.seed ?? 0);
  applyOcclusion(pose, intent.occludedIndices);
  return pose;
}
