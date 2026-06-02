import type { PoseLandmarks } from '@/modules/pose/types';

/** A single timestamped frame of pose data fed into an engine. */
export interface Frame {
  landmarks: PoseLandmarks | null;
  tMs: number;
}

/** MediaPipe BlazePose landmark indices (the ones we touch in kriya-mirror). */
export const IDX = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const LM_COUNT = 33;

/** Squat synth — front-facing pose. Clinical intent inputs. */
export interface SquatPoseIntent {
  /** Knee flexion in degrees. 0 = standing straight, 90 = thighs parallel, 130+ = deep ATG. */
  kneeFlexionDeg: number;
  /** Ratio of ankle-width / shoulder-width. ≥1.05 = wider than shoulders (calibration-valid). */
  feetWidthRatio?: number;
  /** Wrists above shoulders when true (calibration requirement). */
  armsOverhead?: boolean;
  /** 0..0.05 — how much ankle Y rises off the floor (heel lift). Default 0. */
  heelLift?: number;
  /** 0..0.3 — fraction by which knee width shrinks vs baseline (valgus). Default 0. */
  valgusRatio?: number;
  /** 0..90 — forward lean of trunk in degrees. Default 0 (upright). */
  trunkLeanDeg?: number;
  /** Independent override per side. If set, this side's knee flexion takes precedence. */
  leftKneeFlexionDeg?: number;
  rightKneeFlexionDeg?: number;
  /** Body span as fraction of frame height (0.3..0.95). Default 0.70. */
  bodyHeight?: number;
  /** Shoulder-width ratio vs baseline shoulder. <0.5 = sideways. Default 1.0 (facing camera). */
  facingRatio?: number;
  /** Gaussian noise σ on every coordinate. Default 0. */
  noise?: number;
  /** Seed for noise PRNG (deterministic). Default 0. */
  seed?: number;
  /** Uniform visibility for all landmarks. Default 0.95. */
  visibility?: number;
  /** Force these landmark indices to visibility=0 (occlusion). */
  occludedIndices?: number[];
}

/** Bicep Curl synth — front-facing standing pose with both arms parameterized
 *  by elbow flex angle (0° = extended at sides, 150° = fully curled). */
export interface BicepCurlPoseIntent {
  /** Elbow flexion (degrees) applied to BOTH arms. 0 = extended, 90 = forearms horizontal, 150 = fully curled. */
  elbowFlexionDeg: number;
  /** Per-arm override. If set, that arm uses this flex instead of the bilateral value. */
  leftElbowFlexionDeg?: number;
  rightElbowFlexionDeg?: number;
  /** Ankle width / shoulder width. Default 1.0. > 1.20 fails the feetStable calibration gate. */
  feetWidthRatio?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0. > 0.04 triggers torso-swing warning. */
  torsoSwayX?: number;
  /** Elbow forward drift — adds to BOTH elbows' x position (outward from baseline).
   *  Default 0. > 0.06 triggers elbow-drift warning. */
  elbowDriftX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Arm Circles synth — SIDE-facing standing pose with the visible-side wrist
 *  positioned by polar coords around the shoulder. The far-side wrist mirrors
 *  the visible side (since the user moves both arms together) but at reduced
 *  visibility (0.5×) to model side-view occlusion.
 *
 *  Defaults yield IDLE (wrist near shoulder = radius < MIN_RADIUS). To produce
 *  active circling, set `wristRadiusNorm = 0.22` (arm extended) and step
 *  `wristAngleDeg` through 0 → 360 (forward) or 360 → 0 (backward) across
 *  consecutive frames. */
/** 2026-05-28 round 21: Arm Circles re-architected to FRONT-camera. Mirrors
 *  LateralRaisePoseIntent — bilateral arms parameterized by shoulder-abduction
 *  angle (0° = arms at sides, 90° = horizontal, 180° = overhead). Each rep =
 *  one DOWN → overhead → DOWN sweep. */
export interface ArmCirclesPoseIntent {
  /** Shoulder abduction in degrees applied to BOTH arms. 0 = at sides,
   *  90 = horizontal, 180 = overhead. */
  abductionDeg: number;
  /** Per-arm override (for asymmetry tests). */
  leftAbductionDeg?: number;
  rightAbductionDeg?: number;
  /** Ankle width / shoulder width. Default 1.0. > 1.20 fails feetStable. */
  feetWidthRatio?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline. Default 0. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by Fix X cal test. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** 2026-05-28 round 21: Front Raise re-architected to FRONT-camera. Mirrors
 *  LateralRaisePoseIntent — bilateral arms parameterized by shoulder-flexion
 *  angle (0° = arms at sides, 90° = arms forward at shoulder height, 180° =
 *  overhead). The only architectural difference from lateral-raise is the
 *  wrist X projection: at 90° flexion the wrist X stays NEAR the body
 *  midline (forward arm motion), not OUT laterally.
 *
 *  `armOutwardFactor` (default 0.10) controls the lateral offset of the wrist
 *  from the shoulder X at peak flexion, expressed as a fraction of the
 *  lateral-raise outward extension. Setting it to 0.90 simulates a user who
 *  did a lateral raise by mistake — engine should reject with
 *  `arms-out-not-front`. */
export interface FrontRaisePoseIntent {
  /** Shoulder flexion in degrees applied to BOTH arms. 0 = at sides,
   *  90 = arms horizontal forward, 180 = overhead. */
  shoulderFlexionDeg: number;
  /** Per-arm override (used by asymmetry tests). If set, that arm uses this
   *  angle instead of the bilateral value. */
  leftShoulderFlexionDeg?: number;
  rightShoulderFlexionDeg?: number;
  /** Ankle width / shoulder width. Default 1.0. > 1.20 fails the feetStable cal gate. */
  feetWidthRatio?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0. > 0.04 triggers torso-swing warning (form-tracking only — chip
   *  disabled at engine level in round 21). */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate user too far from camera. */
  shoulderWidthOverride?: number;
  /** 2026-05-28 round 21: fraction of lateral-raise outward-wrist extension to
   *  apply. Default 0.25 (front raise — wrists slightly outward to model the
   *  natural elbow flare visible from the front camera; wristOutwardRatio
   *  stays ~0.34 < MAX_WRIST_OUTWARD_RATIO=0.4 so clean reps pass). 0.90+
   *  simulates a LATERAL raise (engine should reject with arms-out-not-front). */
  armOutwardFactor?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** High Knees synth — front-facing standing pose with per-side knee
 *  elevation. The signal is per-side knee Y displacement as a % of shoulder
 *  width (the alternating-rep state machine compares each side to its own
 *  baseline).
 *
 *  Defaults yield BOTH_DOWN (both knees at flat-foot standing baseline).
 *  Increasing `leftKneeLiftPct` raises the LEFT knee; same for `rightKneeLiftPct`.
 *  The ankle on the lifted side rises with the knee (knee drags foot up). */
export interface HighKneesPoseIntent {
  /** Left knee lift as a percent of shoulder width. 0 = flat-foot standing.
   *  ≈ 30 = mid-thigh. ≈ 60 = knee at hip level. */
  leftKneeLiftPct: number;
  /** Right knee lift, analogous to leftKneeLiftPct. */
  rightKneeLiftPct: number;
  /** Torso sway — horizontal displacement of upper body from baseline.
   *  Default 0. > 0.04 triggers torso-swing warning after debounce. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Seated March synth — FRONT-facing SEATED pose (on a chair) with per-side
 *  knee elevation. The signal is per-side knee Y rise vs the seated rest
 *  baseline (% of shoulder width), exactly like High Knees. At rest the knees
 *  sit just below the hips (thighs roughly level — the "seated" calibration
 *  signal); lifting a knee raises it toward the chest.
 *
 *  Defaults yield the seated rest position (both knees down). Increasing
 *  `leftKneeLiftPct` raises the LEFT knee; same for the right. */
export interface SeatedMarchPoseIntent {
  /** Left knee lift as a percent of shoulder width. 0 = seated rest.
   *  ≈ 50 = a clear march lift toward the chest. */
  leftKneeLiftPct: number;
  /** Right knee lift, analogous to leftKneeLiftPct. */
  rightKneeLiftPct: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0 (tracked into the form score only). */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70 (unused — torso span
   *  is fixed; kept for signature parity with the other front-pose builders). */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Calf Raise synth — front-facing standing pose with both heels lifting
 *  together (bilateral). The signal is ankle-Y displacement as a percent of
 *  shoulder width; intent fields express that displacement directly.
 *
 *  Defaults yield flat-foot standing (heelRisePct = 0). */
export interface CalfRaisePoseIntent {
  /** Bilateral heel-rise as a percent of shoulder width (e.g. 12 ≈ ~5 cm at
   *  ~40 cm shoulder span). Applied to BOTH ankles equally unless per-side
   *  overrides are set. Default 0 (flat-footed). */
  heelRisePct: number;
  /** Per-side override. If set, that ankle uses this percent instead of the
   *  bilateral value (used by unilateral / asymmetry tests). */
  leftHeelRisePct?: number;
  rightHeelRisePct?: number;
  /** Ankle width / shoulder width. Default 1.0. Outside 0.5–1.5 fails the
   *  feetHipWidth calibration gate. */
  feetWidthRatio?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0. > 0.04 triggers torso-swing warning after debounce. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Jumping Jacks synth — front-facing standing pose with both arms + both
 *  feet parameterized by openness percent (% of shoulder width).
 *
 *  Defaults yield CLOSED position (arms at sides, feet together). Increasing
 *  `armOpennessPct` raises BOTH wrists above the shoulders. Increasing
 *  `legOpennessPct` separates BOTH ankles outward from the body center.
 *
 *  A full jack lands around armOpennessPct = legOpennessPct = 90-100. */
export interface JumpingJacksPoseIntent {
  /** Arm openness — wrists rise above shoulders by this % of shoulder width
   *  (e.g. 100 → wrists one shoulder-width above shoulder line). Default 0. */
  armOpennessPct: number;
  /** Leg openness — total horizontal separation between ankles as % of
   *  shoulder width (e.g. 100 → ankles one shoulder-width apart). Default 30. */
  legOpennessPct: number;
  /** Per-side overrides. If set, that side uses this percent instead of the
   *  bilateral value (used by unilateral / asymmetry tests). */
  leftArmOpennessPct?: number;
  rightArmOpennessPct?: number;
  leftAnkleOffsetPct?: number;
  rightAnkleOffsetPct?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0. > 0.04 triggers torso-swing warning after debounce. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Standing Side Leg Raise synth — FRONT-facing standing pose with per-side
 *  leg abduction (leg swings OUT to the side in the frontal plane). The signal
 *  is the per-side hip→ankle angle from vertical; intent fields express that
 *  angle directly in degrees.
 *
 *  Defaults yield flat-foot standing (both abduction angles 0 → legs vertical).
 *  Increasing `leftAbductionDeg` swings the LEFT leg out; same for the right.
 *  The knee tracks mid-leg (straight leg) and the ankle leads outward + up. */

/** Cat-Cow synth — SIDE-ON quadruped (on hands and knees). The signal is the
 *  HEAD/NECK pitch: the nose lifts above the shoulder (cow/extension) or tucks
 *  below it (cat/flexion). */
export interface CatCowPoseIntent {
  /** Neck/head pitch in degrees: 0 = neutral; positive = COW (head up,
   *  extension); negative = CAT (head down, flexion). */
  neckPitchDeg: number;
  /** Which side faces the camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Tilt the back/torso off horizontal (deg). 0 = on all fours, back level.
   *  Raise it to fail the "back level" calibration gate. Default 0. */
  backTiltDeg?: number;
  /** Side-on body span |wristX − kneeX| (front hand → back knee). Default 0.35.
   *  Lower it (< 0.25) → fails the distance gate as too-far. */
  bodyLengthX?: number;
  /** Horizontal drift of the hips/pelvis from neutral (rocking — form penalty). Default 0. */
  hipDriftX?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

export interface SideLegRaisePoseIntent {
  /** Left-leg abduction in degrees (0 = vertical/standing, ~35 = a full raise,
   *  90 = leg horizontal). Default 0. */
  leftAbductionDeg?: number;
  /** Right-leg abduction in degrees. Default 0. */
  rightAbductionDeg?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0. > 0.04 contributes to the torso-swing form penalty. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Standing Oblique Side Bend synth — FRONT-facing standing pose with the torso
 *  bent laterally. The signal is the shoulderMid→hipMid lateral lean angle;
 *  `leanDeg` expresses it signed (positive = bend right / shoulders shift to
 *  screen-right, negative = bend left, 0 = upright). Legs stay vertical and the
 *  hips stay level. */
export interface ObliqueSideBendPoseIntent {
  /** Signed lateral lean in degrees. + = bend right, − = bend left, 0 = upright.
   *  A full controlled bend is ~25–30°. Default 0. */
  leanDeg?: number;
  /** Extra downward shoulder drop (normalized y), ON TOP of the lateral lean —
   *  simulates a FORWARD FOLD contaminating the bend. Default 0. Large values
   *  shrink the atan2 denominator (inflating the apparent lean) and raise the
   *  shoulder-drop/lateral-shift ratio, which the engine's forward-fold gate
   *  must reject. */
  forwardFold?: number;
  /** Torso sway — horizontal displacement of the whole body from baseline.
   *  Default 0. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Lunge synth — front-facing pose. One leg active (front), one straight (back). */
export interface LungePoseIntent {
  /** Front-leg knee flex in degrees. 0 = standing, ~90 = deep lunge. */
  kneeFlexionDeg: number;
  /** Which leg is the front (active) leg this rep. Default 'left'. */
  frontLeg?: 'left' | 'right';
  /** Back-leg flex override. Default 0 (straight back leg). Set equal to
   *  `kneeFlexionDeg` to simulate a SQUAT (both legs bend equally), which
   *  the engine rejects as `malformed-rep` via the front-back gap gate. */
  backLegFlexionDeg?: number;
  /** Ankle width / shoulder width. Default 1.0 (hip-width). Lunge calibration
   *  requires ≤ 1.10 (feet-together), wider than that fails the feet gate. */
  feetWidthRatio?: number;
  /** True = wrists below shoulders (lunge-correct calibration). Default true. */
  armsAtSides?: boolean;
  /** Front-knee valgus collapse fraction (0..1). 0 = none, 1 = at midline. */
  valgusRatio?: number;
  /** Forward lean of trunk in degrees. Default 0 (upright). */
  trunkLeanDeg?: number;
  /** Body span as fraction of frame height (0.3..0.95). Default 0.70. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Lateral lunge synth — front-facing pose. One leg steps WIDE to the side and
 *  bends (the working leg); the other stays planted and straight. The pelvis
 *  shifts toward the working side as `lateralShift` grows.
 *
 *  Defaults yield a clean side lunge to the user's left. To simulate a SQUAT
 *  (rejected), set `straightLegFlexionDeg` ≈ `workingKneeFlexionDeg`. To
 *  simulate a stationary knee-bend (rejected — no weight shift), keep
 *  `lateralShift` at 0 while raising `workingKneeFlexionDeg`. */
export interface LateralLungePoseIntent {
  /** Working-leg knee flex in degrees. 0 = standing, ~90 = deep side lunge. */
  workingKneeFlexionDeg: number;
  /** Planted-leg knee flex. Default 5 (straight). Raise toward the working flex
   *  to simulate a squat (fails the working-vs-planted gap gate + fires
   *  leg-not-straight). */
  straightLegFlexionDeg?: number;
  /** Which leg is the working (bending) leg this rep. Default 'left'. */
  workingSide?: 'left' | 'right';
  /** How far the working foot steps out beyond hip-width (normalized X). The
   *  pelvis shifts toward the working side by ~half of this. Default 0 — set it
   *  > 0 (ramped with flex) for a real lunge; keep 0 for a stationary knee bend. */
  lateralShift?: number;
  /** Ankle width / shoulder width at the start (hip-width). Default 1.0. */
  feetWidthRatio?: number;
  /** True = wrists below shoulders (lunge-correct calibration). Default true. */
  armsAtSides?: boolean;
  /** Working-knee valgus collapse fraction (0..1). 0 = none, 1 = at midline. */
  valgusRatio?: number;
  /** Lateral trunk lean in degrees (front camera reads this as trunk-not-upright). Default 0. */
  trunkLeanDeg?: number;
  /** Body span as fraction of frame height (0.3..0.95). Default 0.70. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Cossack-Squat synth — front-on, FIXED wide stance. The user sinks into a
 *  DEEP squat on the working leg while the other leg stays straight; the pelvis
 *  shifts laterally over the working leg (the feet do NOT move). */
export interface CossackSquatPoseIntent {
  /** Working-leg knee flex in degrees. 0 = standing wide, ~100 = deep cossack bottom. */
  workingKneeFlexionDeg: number;
  /** Extended-leg knee flex. Default 5 (straight). Raise it to simulate a
   *  bilateral squat (fails the working-vs-extended gap gate + leg-not-straight). */
  straightLegFlexionDeg?: number;
  /** Which leg is the working (bending) leg this rep. Default 'left'. */
  workingSide?: 'left' | 'right';
  /** Pelvis lateral shift toward the working side (normalized x). Default 0 —
   *  ramp it with flex for a real cossack; keep 0 for a stationary knee bend
   *  (fails the no-lateral-shift gate). */
  hipShift?: number;
  /** Ankle width / shoulder width — the FIXED wide stance. Default 1.8 (wide). */
  feetWidthRatio?: number;
  /** True = wrists below shoulders (cossack-correct calibration). Default true. */
  armsAtSides?: boolean;
  /** Working-knee valgus collapse fraction (0..1). 0 = none, 1 = at midline. */
  valgusRatio?: number;
  /** Lateral trunk lean in degrees (front camera reads this as trunk-not-upright). Default 0. */
  trunkLeanDeg?: number;
  /** Override the default shoulder width (0.16) — for the Fix X distance test. */
  shoulderWidthOverride?: number;
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Push-up synth — side-facing pose. Clinical intent inputs. */
export interface PushupPoseIntent {
  /** Elbow flexion in degrees. 0 = arm fully extended (TOP), ~90 = right-angle (BOTTOM). */
  elbowFlexionDeg: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Horizontal body span as fraction of frame width (0.4..0.95). Default 0.70. */
  bodyLengthX?: number;
  /** Vertical hip deviation from baseline (in normalized y-units).
   *   > 0 = hip below baseline (sag)
   *   < 0 = hip above baseline (pike)
   *   = 0 = perfect plank */
  hipDelta?: number;
  /** Adds a kink at the hip — degrees of spine deviation from straight. */
  spineDeviationDeg?: number;
  /** When true, override elbow.x to shoulder.x to simulate elbow flare
   *  (in side-view, flared elbow appears nearly under the shoulder). */
  elbowFlare?: boolean;
  /** Independent override per side. If set, this side's elbow flex takes precedence. */
  leftElbowFlexionDeg?: number;
  rightElbowFlexionDeg?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Single-Leg-Stand synth — front-facing standing pose with one foot lifted. */
export interface SingleLegStandPoseIntent {
  /** Which side is lifted. Default 'left'. The lifted ankle has a smaller y
   *  (higher in the frame) than the standing ankle. */
  liftedSide?: 'left' | 'right';
  /** How much the lifted ankle is elevated above the standing ankle (in normalized
   *  y-units). Default 0.10. Must exceed `shoulderWidth × 0.40` (~0.064) to pass
   *  the oneFootLifted calibration gate. */
  liftElevation?: number;
  /** Lifted-side hip drop relative to standing-side hip (in normalized y-units).
   *  Default 0. > shoulderWidth × 0.15 (~0.024) triggers hip-tilted warning. */
  hipDrop?: number;
  /** Sway parameters — adds to whole upper body x/y position. */
  swayX?: number;
  swayY?: number;
  /** Shoulder rise (simulates user standing down off the lifted leg). > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** True = arms raised (fails the armsRelaxed calibration gate). Default false. */
  armsRaised?: boolean;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the round-13
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  /** Round 14: decouple the knee Y from the ankle Y. When set, the lifted-side
   *  knee Y is computed using this elevation instead of the default
   *  (hipY + ankleY)/2 midpoint. Lets tests simulate "ankle moved but knee
   *  didn't bend" — the false-positive case from physical testing. */
  kneeLiftOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Star-Pose synth — single-leg balance: stand on one leg, the OTHER leg
 *  extended out to the side (lifted + laterally spread), both arms raised into
 *  a star. */
export interface StarPosePoseIntent {
  /** Which leg is EXTENDED out to the side (default 'left'). The extended ankle
   *  is higher (smaller y) and laterally far from the standing ankle. */
  liftedSide?: 'left' | 'right';
  /** How far the extended ankle sits above the standing ankle (normalized y).
   *  Default 0.10. Must exceed shoulderWidth × 0.12 (~0.019) for the cal lift gate.
   *  Drop near 0 to simulate the extended leg lowering (foot-dropped). */
  liftElevation?: number;
  /** Lateral distance the extended ankle reaches from body center (normalized x).
   *  Default 0.28 → wide star (ankleXSep ≈ 0.32, ratio ~2.0 > the 1.30 cal gate).
   *  Lower it to simulate the leg retracting back in (foot-dropped). */
  legSpread?: number;
  /** True = both arms raised above the shoulders (star arms; passes cal). False =
   *  arms down at the sides (fails cal / triggers arms-dropped). Default true. */
  armsUp?: boolean;
  /** Sway of the upper body / CoM — feet stay planted. */
  swayX?: number;
  swayY?: number;
  /** Shoulder rise (user stood up off the leg). > 0.15 → hold-broken. */
  shoulderRise?: number;
  /** Body span as a fraction of frame height (informational). Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16). < 0.08 → cal rejects as too-far;
   *  < 0.07 → runtime too-far nudge during the hold. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Tandem-Stand synth — front-facing pose with feet in heel-to-toe stance. */
export interface TandemStandPoseIntent {
  /** Which foot is ahead (default 'left'). Ahead foot renders slightly lower in
   *  frame (foreshortening in front-view). */
  tandemAhead?: 'left' | 'right';
  /** Ankle x-distance (normalized). Default 0.030 → tandem (close in x).
   *  Increase to simulate feet drifting apart / hold broken. */
  ankleXSeparation?: number;
  /** CoM sway from the baseline position (added to hip + shoulder X/Y). Default {0,0}. */
  swayX?: number;
  swayY?: number;
  /** True = wrists at hip y (tandem-correct). False = arms raised / off hips. Default true. */
  handsOnHips?: boolean;
  /** Trunk lean in degrees. Default 0 (upright). */
  trunkLeanDeg?: number;
  /** Body span as fraction of frame height (0.3..0.95). Default 0.70. */
  bodyHeight?: number;
  /** Shoulder-rise — simulates user standing up out of stance (hold-broken trigger). */
  shoulderRise?: number;
  /** Override the default shoulder width (0.16) — used by the round-13
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Lateral Raise synth — front-facing standing pose with both arms
 *  parameterized by shoulder-abduction angle (0° = arms at sides,
 *  90° = arms parallel to floor). */
export interface LateralRaisePoseIntent {
  /** Shoulder abduction in degrees applied to BOTH arms. 0 = at sides,
   *  90 = arms parallel to floor, 180 = overhead. */
  abductionDeg: number;
  /** Per-arm override. If set, that arm uses this angle instead of the bilateral value. */
  leftAbductionDeg?: number;
  rightAbductionDeg?: number;
  /** Ankle width / shoulder width. Default 1.0. > 1.20 fails the feetStable calibration gate. */
  feetWidthRatio?: number;
  /** Torso sway — horizontal displacement of the upper body from baseline.
   *  Default 0. > 0.04 triggers torso-swing warning. */
  torsoSwayX?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — used by the Fix X
   *  cal-rejection regression test to simulate a user too far from camera. */
  shoulderWidthOverride?: number;
  /** 2026-05-28 round 19: when true, place wrists at the shoulder X (NOT
   *  outward to the side) — simulates a FRONT raise. Engine should reject
   *  with reason `arms-forward-not-side`. */
  wristForwardOverride?: boolean;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Tree Pose synth — front-facing single-leg balance with the lifted foot
 *  pressed onto the standing leg. Extends the SLS geometry by positioning the
 *  lifted ankle X near the standing-knee X (foot-on-leg), and parking wrists
 *  near chest level by default (hands in prayer position).
 *
 *  `liftedAnkleXOffset` controls the foot-on-leg distance:
 *    0     → ankle exactly on the standing knee X (perfect tree)
 *    0.04  → still within FOOT_ON_LEG_X_TOLERANCE=0.06 (acceptable)
 *    0.10  → past the tolerance → foot-off-leg warning fires after debounce */
export interface TreePosePoseIntent {
  /** Which side is lifted. Default 'left'. */
  liftedSide?: 'left' | 'right';
  /** How much the lifted ankle is elevated above the standing ankle Y.
   *  Default 0.10. Must exceed shoulderWidth × 0.40 (~0.064) to pass the
   *  oneFootLifted calibration gate. */
  liftElevation?: number;
  /** Lifted-side hip drop relative to standing-side hip (in normalized y).
   *  Default 0. > shoulderWidth × 0.15 (~0.024) triggers hip-tilted warning. */
  hipDrop?: number;
  /** Horizontal distance the lifted ankle sits FROM the standing-knee X.
   *  Default 0 (foot exactly on the leg). > 0.06 triggers foot-off-leg
   *  warning after 6-frame hysteresis. */
  liftedAnkleXOffset?: number;
  /** Sway parameters — adds to whole upper body x/y position. */
  swayX?: number;
  swayY?: number;
  /** Shoulder rise (simulates user standing back up). > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** Wrists position. Default 'chest' (prayer at chest level). 'overhead'
   *  raises arms above shoulders. 'sides' would fail cal (use for negative tests). */
  wrists?: 'chest' | 'overhead' | 'sides';
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16) — for Fix X cal-reject test. */
  shoulderWidthOverride?: number;
  /** Round 14 analog — decouple lifted-side knee Y from the ankle. */
  kneeLiftOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Standing Figure-4 synth — single-leg balance: stand on one leg, cross the
 *  other ankle over the standing knee (ankle near the standing-knee X, elevated
 *  to ~knee height), hands at chest, in a mini-squat. Geometrically identical to
 *  Tree Pose's "free foot on the standing leg". */
export interface StandingFigure4PoseIntent {
  /** Which side is crossed over the standing knee. Default 'left'. */
  liftedSide?: 'left' | 'right';
  /** How far the crossed ankle sits above the standing ankle Y. Default 0.10.
   *  Must exceed shoulderWidth × 0.40 (~0.064) for the oneFootLifted cal gate. */
  liftElevation?: number;
  /** Crossed-side hip drop relative to the standing hip (normalized y). Default 0.
   *  > shoulderWidth × 0.15 (~0.024) triggers hip-tilted. */
  hipDrop?: number;
  /** Horizontal distance the crossed ankle sits FROM the standing-knee X.
   *  Default 0 (ankle exactly on the knee). > 0.06 triggers foot-off-leg after
   *  6-frame hysteresis. */
  liftedAnkleXOffset?: number;
  /** Sway of the upper body / CoM — feet stay planted. */
  swayX?: number;
  swayY?: number;
  /** Shoulder rise (user stood back up). > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** Wrists position. Default 'chest'. 'overhead' raises arms; 'sides' fails cal. */
  wrists?: 'chest' | 'overhead' | 'sides';
  /** Body span as a fraction of frame height (informational). Default 0.70. */
  bodyHeight?: number;
  /** Override the default shoulder width (0.16). < 0.08 → cal rejects as too-far;
   *  < 0.07 → runtime too-far nudge during the hold. */
  shoulderWidthOverride?: number;
  /** Decouple crossed-side knee Y from the ankle (Fix Y false-positive test). */
  kneeLiftOverride?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Gate-Pose synth — front-on kneeling lateral side-bend: one leg extended out
 *  to the side (wide stance), torso bent sideways, the top arm reaching up and
 *  over. Tracked via lateral-lean magnitude + top-arm height. */
export interface GatePosePoseIntent {
  /** Which way the torso bends / which leg is extended. Default 'right'. */
  bendSide?: 'left' | 'right';
  /** Lateral lean magnitude in degrees. Default 30. < ~14 mid-hold triggers
   *  incomplete-bend; < 18 fails calibration. */
  leanDeg?: number;
  /** True = top arm raised above the shoulder (default). False = top arm
   *  dropped to shoulder height (fails cal / triggers arms-not-overhead). */
  topArmUp?: boolean;
  /** Lateral distance the extended ankle reaches from body center (normalized x).
   *  Default 0.24 → wide stance. Lower it to fail the wideStance gate. */
  legSpread?: number;
  swayX?: number;
  swayY?: number;
  /** Shoulder rise (user came all the way up). > 0.15 → hold-broken. */
  shoulderRise?: number;
  /** Override the default shoulder width (0.16). < 0.08 → cal too-far;
   *  < 0.09 → runtime too-far nudge. */
  shoulderWidthOverride?: number;
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Warrior II synth — side-facing lunge stance. Two legs visible:
 *  front leg with bent knee (~90°), back leg straight. Auto-detection at the
 *  engine picks the leg with the larger knee flex as "front".
 *
 *  Each leg's knee flex is independently controllable.
 */
export interface WarriorTwoPoseIntent {
  /** Front-leg knee flex in degrees (squat geometry: 0 = straight, 90 = parallel). */
  frontKneeFlexionDeg: number;
  /** Back-leg knee flex. Default 5° (essentially straight). */
  backKneeFlexionDeg?: number;
  /** Which side faces the camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Which leg is the "front" leg. Default 'right' (user's right foot forward). */
  frontLeg?: 'left' | 'right';
  /** Ankle X distance in normalized coords. Default 0.34 (wide lunge). */
  stanceWidth?: number;
  /** Trunk lean forward in degrees from vertical. Default 5°. */
  trunkLeanDeg?: number;
  /** Shoulder rise — simulates user standing up. > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** Body height in frame Y-axis (ankle-Y to shoulder-Y span). Default 0.55. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Warrior I synth — side-on lunge stance with arms reaching overhead.
 *  Identical lower-body geometry to Warrior II (front leg bent, back leg
 *  straight, auto-detected by larger knee flex), plus an `armsRaised` control:
 *  when true (default) both wrists sit clearly above both shoulders (the
 *  Warrior I overhead reach); when false the wrists drop to hip level
 *  (fails the armsOverhead cal gate / fires arms-not-overhead at runtime).
 */
export interface WarriorOnePoseIntent {
  /** Front-leg knee flex in degrees (squat geometry: 0 = straight, 90 = parallel). */
  frontKneeFlexionDeg: number;
  /** Back-leg knee flex. Default 5° (essentially straight). */
  backKneeFlexionDeg?: number;
  /** Which side faces the camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Which leg is the "front" leg. Default 'right' (user's right foot forward). */
  frontLeg?: 'left' | 'right';
  /** Ankle X distance in normalized coords. Default 0.34 (wide lunge). */
  stanceWidth?: number;
  /** Trunk lean forward in degrees from vertical. Default 5°. */
  trunkLeanDeg?: number;
  /** Both arms overhead (default true) or dropped to hip level (false). */
  armsRaised?: boolean;
  /** Shoulder rise — simulates user standing up. > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** Body height in frame Y-axis (ankle-Y to shoulder-Y span). Default 0.55. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Warrior III synth — side-on airplane "T". The body faces +X (torso + arms
 *  reach forward / +X; the lifted leg reaches back / -X). The standing leg drops
 *  vertically to the floor; the lifted leg extends back toward horizontal.
 *
 *  Defaults yield a clean T: torso + back leg near level, standing leg straight.
 *  Raise `torsoPitchFromHorizontalDeg` to simulate standing too upright;
 *  raise `backLegAngleFromHorizontalDeg` to simulate a dropped back leg;
 *  raise `standingKneeFlexionDeg` to bend the standing leg. */
export interface Warrior3PoseIntent {
  /** Torso pitch from horizontal (0 = level T, 90 = upright). Default 10. */
  torsoPitchFromHorizontalDeg?: number;
  /** Back-leg angle from horizontal (0 = level, 90 = hanging straight down). Default 10. */
  backLegAngleFromHorizontalDeg?: number;
  /** Standing-knee flex (0 = straight). Default 5. */
  standingKneeFlexionDeg?: number;
  /** Which leg is the lifted (back) leg. Default 'left'. */
  liftedSide?: 'left' | 'right';
  /** Shoulder rise — simulates the user standing up. > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** Torso length (shoulder-mid → hip-mid distance) — distance scale. Default 0.18. */
  torsoLen?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Side Plank synth — CHEST facing the camera. The body is an elongated line
 *  across the frame (shoulder-mid left, ankle-mid right); left/right landmarks
 *  are stacked vertically around each midpoint (the side-lying stack).
 *
 *  Defaults yield a clean straight side plank. Raise `hipDelta` (> 0) to sag the
 *  hips toward the floor (hip-sag); set it < 0 to pike; raise `shoulderRise`
 *  past 0.18 to simulate the user sitting up (hold-broken). */
export interface SidePlankPoseIntent {
  /** Hip-mid Y offset from the shoulder→ankle line. > 0 = sag, < 0 = pike. Default 0. */
  hipDelta?: number;
  /** Shoulder rise — simulates the user sitting/standing up. > 0.18 triggers hold-broken. */
  shoulderRise?: number;
  /** Body length (shoulder-mid → ankle-mid X span). Default 0.60. */
  bodyLengthX?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Boat Pose synth — side-on seated "V". The hip (sit bone) is the vertex; the
 *  torso reaches up-and-back (−X), the legs reach up-and-forward (+X). Both
 *  angles are measured from horizontal.
 *
 *  Defaults yield a clean V. Lower `legAngleDeg` to sag the legs (legs-dropped),
 *  lower `torsoAngleDeg` to collapse the chest (chest-dropped); drop BOTH low to
 *  fully collapse the V (hold-broken). */
export interface BoatPosePoseIntent {
  /** Torso angle from horizontal (chest lifted / leaning back). Default 45. */
  torsoAngleDeg?: number;
  /** Leg angle from horizontal (legs lifted into the V). Default 40. */
  legAngleDeg?: number;
  /** Torso length (shoulder-mid → hip-mid distance) — distance scale. Default 0.18. */
  torsoLen?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Mountain Pose synth — front-facing upright standing pose.
 *  Parameterized by shoulder tilt, hip tilt, and spine X offset, plus the
 *  standard sway / shoulder-rise / bodyHeight controls.
 *
 *  Defaults yield a clean Tadasana: shoulders + hips perfectly level, spine
 *  vertical, feet close together, arms relaxed at sides.
 */
export interface MountainPosePoseIntent {
  /** Shoulder tilt — adds (positive = right side lower) to right-shoulder Y.
   *  Default 0. Above ~0.025 contributes substantially to postureDeviation. */
  shoulderTilt?: number;
  /** Hip tilt — analog of shoulderTilt for hips. Default 0. */
  hipTilt?: number;
  /** Horizontal offset between shoulder-mid and hip-mid (spine non-vertical).
   *  Default 0. Above ~0.025 → posture-not-aligned after debounce. */
  spineOffsetX?: number;
  /** Sway parameters — adds to whole upper body x/y position. */
  swayX?: number;
  swayY?: number;
  /** Shoulder rise — simulates user stepping away. > 0.15 triggers hold-broken. */
  shoulderRise?: number;
  /** Ankle X distance as fraction of normalized coords. Default 0.06 (feet
   *  close together / hip-width). > shoulderWidth × 0.50 → feet-close gate fails. */
  ankleXDistance?: number;
  /** Body span as fraction of frame height. Default 0.70. */
  bodyHeight?: number;
  /** Override default shoulder width (0.16) — for Fix X cal-reject test. */
  shoulderWidthOverride?: number;
  /** 2026-05-28 round 19: Tadasana variant requires arms OVERHEAD. Default
   *  TRUE now (was false). Set false to simulate arms-at-sides → fails
   *  the armsOverhead cal gate / fires arms-not-overhead runtime warning. */
  armsRaised?: boolean;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Chair Pose synth — side-facing standing pose with knees bent into a
 *  partial squat. Mirrors plank's side-projection pattern. */
export interface ChairPosePoseIntent {
  /** Knee flexion in degrees (squat-geometry convention: 0 = straight,
   *  90 = thighs near parallel, 150 = deep squat). Target hold ≈ 80–100°. */
  kneeFlexionDeg: number;
  /** Trunk lean forward from vertical in degrees. Default 5 (a slight forward
   *  counterbalance is natural in chair pose). > 30 triggers torso-too-forward. */
  trunkLeanDeg?: number;
  /** Heel lift: ankle Y rises by this amount vs baseline (heel off the floor).
   *  Default 0. > 0.03 triggers heel-lift. */
  heelLift?: number;
  /** Shoulder rise: shoulder Y rises by this amount vs baseline (user standing
   *  back up). Default 0. > 0.12 triggers hold-broken. */
  shoulderRise?: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Vertical body span (head-Y at top, ankle-Y at bottom). Default 0.65.
   *  Below MIN_BODY_HEIGHT_RUNTIME=0.30 triggers calibration too-far hint. */
  bodyHeight?: number;
  /** True = arms extended forward (calibration-valid). False = arms at sides
   *  (fails the armsReady gate). Default true. */
  armsExtended?: boolean;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Wall Sit synth — side-facing pose, back vertical against a wall, knees bent
 *  into a held partial squat. Geometrically identical to Chair Pose (knee
 *  flexion + trunk lean + heel lift + shoulder rise), so the builder delegates
 *  to buildChairPosePose. Default trunkLeanDeg is small (back flat on wall).
 *
 *  Defaults yield a clean wall sit (knee flexion supplied by the caller, back
 *  upright). Set trunkLeanDeg high to peel the back off the wall, heelLift to
 *  lift onto the toes, shoulderRise to slide/stand back up. */
export interface WallSitPoseIntent {
  /** Knee flexion in degrees (squat-geometry: 0 = straight, ~90 = thighs
   *  parallel). Wall-sit target hold ≈ 90°. */
  kneeFlexionDeg: number;
  /** Trunk lean forward from vertical in degrees. Default 4 (back flat on the
   *  wall). > 25 triggers torso-too-forward. */
  trunkLeanDeg?: number;
  /** Heel lift: ankle Y rises by this amount vs baseline (heel off the floor).
   *  Default 0. > 0.03 triggers heel-lift. */
  heelLift?: number;
  /** Shoulder rise: shoulder Y rises by this amount vs baseline (user sliding /
   *  standing back up). Default 0. > 0.12 triggers hold-broken. */
  shoulderRise?: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Vertical body span (shoulder-Y to ankle-Y). Default 0.65. Below
   *  MIN_BODY_HEIGHT_RUNTIME=0.30 triggers the calibration too-far hint. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Standing Forward Fold synth — side-facing pose. The torso hinges forward
 *  from the hips by `foldAngleDeg`; the legs stay near-straight. Geometrically
 *  identical to Chair Pose (knee flexion + trunk fold + body span), so the
 *  builder delegates to buildChairPosePose with trunkLeanDeg = foldAngleDeg.
 *
 *  Defaults yield a clean deep fold. Lower `foldAngleDeg` toward 30 to simulate
 *  coming up out of the fold (not-folded-enough); below ~30 the engine treats
 *  it as standing up (hold-broken). Raise `kneeFlexionDeg` past 35 to bend the
 *  knees (leg-not-straight). */
export interface ForwardFoldPoseIntent {
  /** Torso fold angle from vertical (0 = upright, 60+ = deep hinge). The hold
   *  accumulates once this passes the engine's FOLD_HOLD_MIN_DEG = 50; below
   *  STAND_BROKEN_DEG = 30 the engine reports hold-broken (user stood up). */
  foldAngleDeg: number;
  /** Knee flexion in degrees (0 = straight legs, > 35 = knees bending →
   *  leg-not-straight). Default 5 (soft-straight hinge). */
  kneeFlexionDeg?: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Vertical body span (ankle-Y to shoulder-Y). Default 0.60. Below the
   *  calibration floor (0.40) → too-far; above 0.92 → too-close. */
  bodyHeight?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Downward Dog synth — side-facing inverted V. The hip is the apex; the torso
 *  reaches down-forward to the hands, the legs reach down-back to the feet, each
 *  limb at ±(apex/2) from the downward vertical. The engine reads the hip apex
 *  interior angle (~90 = sharp V, →180 = flat / hips dropped).
 *
 *  Defaults yield a clean Down Dog. Raise `apexAngleDeg` toward 135 to drop the
 *  hips (hip-sag); past ~150 the engine treats it as the V collapsing
 *  (hold-broken). */
export interface DownwardDogPoseIntent {
  /** Hip apex interior angle in degrees (~90 = sharp inverted V). The engine's
   *  hold accumulates while apex ≤ APEX_HOLD_MAX = 115; > APEX_BROKEN = 150 →
   *  hold-broken. */
  apexAngleDeg: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Vertical leg drop |ankleY − hipY|. Default 0.35. Below the calibration
   *  floor (0.18) → too-far; above 0.55 → too-close. */
  bodyHeight?: number;
  /** Knee flexion in degrees (0 = legs straight). Default 0. > KNEE_BENT_MAX_DEG
   *  (28) → `leg-not-straight`. The knee is offset perpendicular to the hip→ankle
   *  line so the engine reads this flexion back. */
  kneeFlexionDeg?: number;
  /** Elbow flexion in degrees (0 = arms straight). Default 0. > ARM_BENT_MAX_DEG
   *  (28) → `arms-not-straight`. The elbow is offset perpendicular to the
   *  shoulder→wrist line. */
  armFlexionDeg?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Cobra Pose synth — side-facing prone backbend. The lower body (hip → ankle)
 *  lies flat along the floor; the torso (hip → shoulder) lifts forward-and-up by
 *  `elevationDeg`. The engine reads the torso elevation angle above horizontal
 *  (~0 = lying flat, higher = chest lifted).
 *
 *  Defaults yield a clean cobra. Lower `elevationDeg` toward 10 to drop the chest
 *  (chest-not-lifted); below ~6 the engine treats it as laying flat (hold-broken). */
export interface CobraPosePoseIntent {
  /** Torso elevation above horizontal in degrees (~0 = flat, ~25-30 = a good
   *  cobra). The engine's hold accumulates while elevation ≥ ELEV_HOLD_MIN = 14;
   *  < ELEV_REST = 6 → hold-broken. */
  elevationDeg: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Horizontal body span |shoulderX − ankleX|. Default 0.55. Below the
   *  calibration floor (0.35) → too-far; above 0.95 → too-close. */
  bodyLengthX?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Seated Forward Fold synth — side-facing long-sitting pose. The legs extend
 *  forward along the floor (hip → knee → ankle horizontal); the torso hinges
 *  up/forward from the hip by `foldAngleDeg`. The engine reads the torso fold
 *  angle from vertical (0 = sitting tall, →90 = folded over the legs).
 *
 *  Defaults yield a clean deep fold. Lower `foldAngleDeg` toward 25 to come up
 *  out of the fold (not-folded-enough); below ~25 the engine treats it as
 *  sitting back up (hold-broken). */
export interface SeatedForwardFoldPoseIntent {
  /** Torso fold angle from vertical (0 = sitting tall, 50+ = deep fold). The
   *  engine's hold accumulates once this passes FOLD_HOLD_MIN_DEG = 45; below
   *  STAND_BROKEN_DEG = 25 → hold-broken. */
  foldAngleDeg: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Leg span |hipX − ankleX| (the distance proxy). Default 0.55. Below the
   *  calibration floor (0.30) → too-far; above 0.95 → too-close. */
  bodyLengthX?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Plank synth — side-facing pose. */
export interface PlankPoseIntent {
  /** Vertical hip deviation from baseline (in normalized y-units).
   *   > 0 = hip below baseline (sag)
   *   < 0 = hip above baseline (pike)
   *   = 0 = perfect plank */
  hipDelta?: number;
  /** Adds an angular kink at the hip — degrees of spine deviation from straight. */
  spineDeviationDeg?: number;
  /** Nose drops below shoulder by this much (positive = drooping). */
  neckDroop?: number;
  /** Shoulder rises this much vs baseline (positive = standing up).
   *  > 0.18 triggers hold-broken. */
  shoulderRise?: number;
  /** Side facing camera. Default 'left'. */
  side?: 'left' | 'right';
  /** Horizontal body span as fraction of frame width (0.4..0.95). Default 0.70. */
  bodyLengthX?: number;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Triangle Pose synth — FRONT-facing wide-stance pose with both legs
 *  STRAIGHT, one arm reaching straight up, the other reaching down toward
 *  the front-foot toe (lateral hinge in the camera plane).
 *
 *  Default intent yields a clean Trikonasana (top-arm vertical, both knees
 *  straight, hips stacked, front foot toward camera). Controls let tests
 *  inject knee bends, arm tilts, hip-rolls, trunk-forward collapse, and
 *  shoulder-rise (for hold-broken). */
export interface TrianglePosePoseIntent {
  /** Front-leg knee flex in degrees (squat-geometry: 0 = straight, ~90 =
   *  parallel). Triangle target: < 5°. > 25° fires `leg-not-straight`. */
  frontKneeFlexionDeg?: number;
  /** Back-leg knee flex. Default 5° (essentially straight). */
  backKneeFlexionDeg?: number;
  /** Which leg is the FRONT leg — the foot the BOTTOM hand reaches toward.
   *  Default 'right'. By classical convention, the OPPOSITE arm is the
   *  top/sky arm. */
  frontLeg?: 'left' | 'right';
  /** Top-arm tilt in degrees from vertical. 0 = perfectly straight up;
   *  > 20° triggers `top-arm-not-vertical`. */
  topArmTiltDeg?: number;
  /** How far the bottom-arm wrist sits ABOVE the front-ankle Y, normalized
   *  by bodyHeight. 0 = wrist exactly at the ankle. Positive = wrist raised
   *  above the ankle = bad. > 0.15 fires `bottom-arm-not-down`. Default
   *  −0.05 (wrist a little below the ankle = ideal reach to the toe). */
  bottomArmLiftFromAnkle?: number;
  /** Ankle X distance in normalized coords. Default 0.34 (wide stance). */
  stanceWidth?: number;
  /** Shoulder rise — simulates user standing up. > 0.15 triggers
   *  `hold-broken`. */
  shoulderRise?: number;
  /** Body span as fraction of frame height (ankle-Y to shoulder-Y).
   *  Default 0.50 (front-view triangle has the shoulder mid at mid-frame
   *  since the trunk is hinged laterally, not straight up). */
  bodyHeight?: number;
  /** Override default shoulder width (0.16) — for Fix X cal-reject test. */
  shoulderWidthOverride?: number;
  /** True = both wrists at chest level (negative cal test — fails the
   *  triangle-posture gate). Default false. */
  armsAtChest?: boolean;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}

/** Goddess Pose synth — FRONT-facing wide-stance squat with both knees bent
 *  and arms in "cactus" position (shoulders abducted ~90°, elbows bent ~90°
 *  at shoulder height, palms forward → wrists above elbows).
 *
 *  Defaults yield a clean Goddess Pose: feet ~2× shoulder-width, mean knee
 *  flex 90°, knees tracking over ankles, elbows at shoulder height. */
export interface GoddessPosePoseIntent {
  /** Mean knee flex applied to BOTH legs (0 = standing straight, 90 = thighs
   *  parallel, 130 = deep squat). Target hold range: 80–100°. */
  kneeFlexionDeg: number;
  /** Ankle X separation (normalized coords). Default 0.30 (~2× default
   *  shoulderWidth 0.16). Below 0.26 fails the wide-stance gate. */
  stanceWidth?: number;
  /** Knee-X separation as a fraction of ankle-X separation. 1.0 = knees
   *  tracking over ankles (no valgus). 0.7 → knees caving (engine fires
   *  knees-caving when ratio < 0.75). Default 1.0. */
  kneeAnkleRatio?: number;
  /** How far BOTH elbows are dropped below the cactus line (shoulder Y),
   *  as a fraction of shoulder width. Default 0 = at shoulder height.
   *  > 0.10 → engine fires arms-dropped after debounce. */
  elbowDropFraction?: number;
  /** Trunk lean forward in degrees from vertical. Default 0. > 20 triggers
   *  torso-too-forward. */
  trunkLeanDeg?: number;
  /** Shoulder rise — simulates user standing back up. > 0.15 triggers
   *  hold-broken. */
  shoulderRise?: number;
  /** Body span as fraction of frame height. Default 0.65. */
  bodyHeight?: number;
  /** Override default shoulder width (0.16) — for Fix X cal-reject test. */
  shoulderWidthOverride?: number;
  /** True = arms relaxed at sides (fails the cactus calibration gate).
   *  Used by negative cal tests. Default false. */
  armsAtSides?: boolean;
  noise?: number;
  seed?: number;
  visibility?: number;
  occludedIndices?: number[];
}
