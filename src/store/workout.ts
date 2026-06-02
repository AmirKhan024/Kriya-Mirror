import { create } from 'zustand';
import type { ExerciseConfig } from '@/config/exercises/types';

export type WarningType =
  | 'heel-lift'
  | 'valgus'
  | 'trunk-forward'
  | 'feet-narrow'
  | 'not-facing'
  | 'too-close'
  | 'too-far'
  | 'not-moving'
  | 'malformed-rep'
  // Hold-based (Plank, Yoga, Balance, etc.)
  | 'hip-sag'
  | 'hip-pike'
  | 'spine-misaligned'
  | 'neck-droop'
  | 'hold-broken'
  // Push-up specific
  | 'elbow-flare'
  | 'incomplete-pushup'
  // Lunge specific
  | 'knee-past-toe'
  | 'incomplete-lunge'
  // Balance specific
  | 'swaying'
  | 'feet-separated'
  // Bicep curl specific
  | 'torso-swing'
  | 'elbow-drift'
  | 'incomplete-curl'
  // Single-leg balance specific
  | 'hip-tilted'
  // Cross-cutting tracking-validity (any engine, post-cal)
  | 'position-lost'
  // Tandem stand / balance: subtle coaching cue (doesn't freeze timer)
  | 'hands-off-hips'
  // Single-leg stand: lifted foot landed (recoverable — freezes timer, doesn't terminate)
  | 'foot-dropped'
  // Chair pose: knees coming up out of the hold (recoverable — freezes timer)
  | 'knee-too-straight'
  // Chair pose: torso leaning too far forward (recoverable — freezes timer)
  | 'torso-too-forward'
  // Chair pose: sunk past chair pose into a full squat (recoverable — freezes timer)
  | 'knee-too-deep'
  // Lateral raise: half-rep — peak shoulder abduction didn't reach shoulder height
  | 'incomplete-raise'
  // Lateral raise: L vs R arm peak abduction differ > 15° at rep complete
  | 'arm-asymmetry'
  // Tree pose: lifted foot drifted off the standing leg (recoverable — freezes timer)
  | 'foot-off-leg'
  // Warrior II: front knee too straight (standing too tall, not in the lunge)
  | 'front-knee-not-bent-enough'
  // Warrior II: front knee past 90°/toes (going too deep)
  | 'front-knee-bent-too-much'
  // Warrior II: back leg bending (should stay straight)
  | 'back-knee-bent'
  // Mountain Pose: combined posture misalignment (shoulders/hips/spine)
  | 'posture-not-aligned'
  // Calf raise: rep complete but peak heel-rise didn't clear MIN_REP_DEPTH_PCT
  | 'low-heel-rise'
  // Jumping jacks: half-jack (arms-only OR feet-only — peak arm or leg
  // openness didn't clear MIN_REP_OPENNESS_PCT)
  | 'incomplete-jack'
  // High knees: peak knee lift didn't clear MIN_REP_HEIGHT_PCT
  | 'low-knee-lift'
  // Goddess Pose: knees collapsing inward (valgus) below the ankle line
  | 'knees-caving'
  // Goddess Pose: elbows dropping below shoulder height (cactus arms broken)
  | 'arms-dropped'
  // Triangle Pose: either knee bending (both legs should stay straight)
  | 'leg-not-straight'
  // Triangle Pose: top/raised arm tilting forward or back from vertical
  | 'top-arm-not-vertical'
  // Triangle Pose: bottom arm lifted away from the front foot (toe-reach broken)
  | 'bottom-arm-not-down'
  // Lateral Raise: arms went OVERHEAD (shoulder press, not lateral raise)
  | 'arms-too-high'
  // Lateral Raise: arms went FORWARD (front raise, not lateral)
  | 'arms-forward-not-side'
  // Front Raise: arms went OUT laterally (lateral raise, not front raise)
  | 'arms-out-not-front'
  // Calf Raise (round 22 hold): heels dropped mid-hold — timer pauses, warning fires once with cooldown
  | 'heel-dropped'
  // Mountain Pose (Tadasana with overhead reach): wrists fell below shoulder line mid-hold
  | 'arms-not-overhead'
  // Standing Side Leg Raise: rep complete but peak hip abduction didn't clear MIN_REP_ABDUCTION_DEG
  | 'low-leg-raise'
  // Standing Oblique Side Bend: rep complete but peak lateral lean didn't clear MIN_REP_LEAN_DEG
  | 'incomplete-bend'
  // Sit-to-Stand: started rising but sat back down without standing fully
  | 'incomplete-stand'
  // Warrior III: torso not hinged toward horizontal (too upright — lift into the T)
  | 'torso-not-level'
  // Warrior III: back leg dropped — lift/extend it higher toward horizontal
  | 'back-leg-low'
  // Boat Pose: legs sagging toward the floor — lift them back into the V
  | 'legs-dropped'
  // Boat Pose: chest collapsing — lift the chest and lean back into the V
  | 'chest-dropped'
  // Standing Forward Fold: torso came up out of the fold (recoverable — freezes timer)
  | 'not-folded-enough'
  // Cobra Pose: chest dropped toward the floor (recoverable — freezes timer)
  | 'chest-not-lifted'
  // Cat-Cow: a cycle didn't move through a full range — arch and round the spine more
  | 'shallow-spine-rom'
  // Downward Dog: arms bending (should stay straight — recoverable, freezes timer)
  | 'arms-not-straight'
  // ── Strength exercises (integrated from Bilal's repo) ──
  // Conventional Deadlift: spine rounding under load / hips rising faster than chest / short ROM
  | 'rounded-back'
  | 'hips-shooting-up'
  | 'incomplete-deadlift'
  // Pull-Up: shoulders shrugging instead of pulling / short ROM
  | 'shoulder-shrug'
  | 'incomplete-pullup'
  // Overhead Press: lower-back arch / bar drifting off vertical / short lockout
  | 'lower-back-arch'
  | 'bar-path-drift'
  | 'incomplete-press'
  // Barbell Row: using momentum / short ROM
  | 'row-momentum'
  | 'incomplete-row'
  // Romanian Deadlift: spine rounding / knees over-bending into a squat / short ROM
  | 'rdl-back-rounded'
  | 'excessive-knee-bend'
  | 'incomplete-rdl'
  // Kettlebell Swing: squatting instead of hinging / arm-dominant swing / short hip extension
  | 'squat-pattern'
  | 'arm-lift'
  | 'incomplete-extension'
  // Burpee: missing the jump / not getting into full plank
  | 'no-jump'
  | 'incomplete-plank'
  // Box Jump: stiff landing / no hip-load / short jump
  | 'stiff-landing'
  | 'no-loading'
  | 'incomplete-jump'
  // Mountain Climber: knee not driving to chest
  | 'incomplete-drive'
  // Lateral Raise: arms going above parallel
  | 'above-parallel'
  // Star Jump: arms not reaching overhead
  | 'incomplete-star-jump'
  // Glute Bridge: hips not reaching full extension
  | 'incomplete-bridge'
  // Overhead Tricep Extension: short ROM
  | 'incomplete-tricep-extension'
  // Chair Dip: elbows not bending to 90°
  | 'incomplete-dip'
  // Dead Bug: lower back lifting off / short limb extension
  | 'hip-lift-off'
  | 'incomplete-dead-bug'
  // Inchworm: short hinge / not reaching floor
  | 'incomplete-inchworm'
  // Jump Squat: short jump ROM
  | 'incomplete-jump-squat'
  // Shrug: incomplete shoulder elevation
  | 'incomplete-shrug'
  // Superman: chest/legs not lifting high enough
  | 'incomplete-superman'
  // Bird-Dog: limbs not extending fully
  | 'incomplete-bird-dog'
  // Step-Up: not driving all the way up onto the step
  | 'incomplete-step-up'
  // Walking Lunge: front thigh not reaching parallel
  | 'incomplete-walking-lunge'
  // Reverse Fly: arms not reaching shoulder height
  | 'incomplete-reverse-fly'
  // Goblet Squat: elbows collapsing / not reaching depth
  | 'goblet-elbows-collapsing'
  | 'incomplete-goblet-squat'
  // Donkey Kick: heel not driving high enough
  | 'incomplete-donkey-kick'
  // Fire Hydrant: knee not abducting high enough
  | 'incomplete-fire-hydrant'
  // Curtsy Lunge: short ROM / hip swinging / torso leaning / knee valgus
  | 'incomplete-curtsy-lunge'
  | 'hip-rotation-curtsy'
  | 'trunk-lean'
  | 'knee-valgus'
  // Pallof Press: arms not extending fully / torso rotating
  | 'incomplete-pallof-press'
  | 'torso-rotation-pallof'
  // Lateral Band Walk: steps not tracking / hip drop
  | 'steps-not-tracked'
  | 'hip-drop'
  // Pistol Squat: not reaching depth
  | 'incomplete-pistol-squat'
  // Nordic Curl: not lowering far enough
  | 'incomplete-nordic-curl'
  // Clamshell: knee not opening high enough
  | 'incomplete-clamshell';

export interface RepRecord {
  index: number;
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
  timestamp: number;
}

export interface SetRecord {
  setNumber: number;
  plannedReps: number;
  reps: RepRecord[];
  mqs: number;
  warningCounts: Record<WarningType, number>;
  startedAt: number;
  completedAt?: number;
}

/** A single static-hold session (Plank, Tree Pose, Wall Sit, etc.). */
export interface HoldRecord {
  targetDurationSec: number;
  actualDurationSec: number;
  averageMqs: number;
  warningCounts: Record<WarningType, number>;
  /** 1Hz form samples for the report's form-over-time chart */
  formTimeSeries: Array<{ t: number; mqs: number }>;
  startedAt: number;
  completedAt?: number;
  broken: boolean;
  /** 2026-05-25 round 9: longest continuous unfrozen-form streak (seconds).
   *  Equal to actualDurationSec when the user never broke form, smaller when
   *  the hold-counter freeze fired one or more times. */
  longestUnfrozenSec: number;
}

export type WorkoutStatus = 'idle' | 'setup' | 'tracking' | 'resting' | 'complete';

export interface WorkoutSetup {
  // Rep-based fields (optional; required only for rep-based)
  plannedSets?: number;
  plannedRepsPerSet?: number;
  restSec?: number;
  weightKg?: number;
  // Hold-based fields (optional; required only for hold-based)
  holdDurationSec?: number;
}

interface WorkoutState {
  exercise: ExerciseConfig | null;
  setup: WorkoutSetup | null;
  status: WorkoutStatus;
  // Rep-based state
  currentSetIndex: number;
  sets: SetRecord[];
  restEndsAt: number | null;
  // Hold-based state
  holdRecord: HoldRecord | null;
  // Common timestamps
  workoutStartedAt: number | null;
  workoutEndedAt: number | null;
  /** 2026-05-25: true if user tapped the manual "Complete" button mid-workout
   *  (not played to natural completion). Report page surfaces this with a
   *  banner. Reset on initWorkout / playAgain / reset. */
  manuallyEnded: boolean;

  initWorkout: (exercise: ExerciseConfig, setup: WorkoutSetup) => void;
  // Rep-based actions
  recordRep: (rep: Omit<RepRecord, 'index' | 'timestamp'>) => void;
  completeSet: () => void;
  startRest: () => void;
  skipRest: () => void;
  beginNextSet: () => void;
  // Hold-based actions
  recordHoldTick: (mqs: number, secondsElapsed: number, longestUnfrozenSec?: number, warning?: WarningType) => void;
  completeHold: (broken: boolean) => void;
  // Shared
  finishWorkout: () => void;
  reset: () => void;
  /** 2026-05-25: end the workout early as if user tapped "Complete" mid-session.
   *  Sets manuallyEnded=true, status=complete, workoutEndedAt=now.
   *  Sets+holdRecord are preserved so report can show partial stats. */
  manualEndWorkout: () => void;
  /** 2026-05-25: restart the SAME workout (preserves exercise + setup) but
   *  wipes scores. Caller navigates to /[id]/play afterwards. */
  playAgain: () => void;
}

function emptyWarningCounts(): Record<WarningType, number> {
  return {
    'heel-lift': 0,
    valgus: 0,
    'trunk-forward': 0,
    'feet-narrow': 0,
    'not-facing': 0,
    'too-close': 0,
    'too-far': 0,
    'not-moving': 0,
    'malformed-rep': 0,
    'hip-sag': 0,
    'hip-pike': 0,
    'spine-misaligned': 0,
    'neck-droop': 0,
    'hold-broken': 0,
    'elbow-flare': 0,
    'incomplete-pushup': 0,
    'knee-past-toe': 0,
    'incomplete-lunge': 0,
    swaying: 0,
    'feet-separated': 0,
    'torso-swing': 0,
    'elbow-drift': 0,
    'incomplete-curl': 0,
    'hip-tilted': 0,
    'position-lost': 0,
    'hands-off-hips': 0,
    'foot-dropped': 0,
    'knee-too-straight': 0,
    'torso-too-forward': 0,
    'knee-too-deep': 0,
    'incomplete-raise': 0,
    'arm-asymmetry': 0,
    'foot-off-leg': 0,
    'front-knee-not-bent-enough': 0,
    'front-knee-bent-too-much': 0,
    'back-knee-bent': 0,
    'posture-not-aligned': 0,
    'low-heel-rise': 0,
    'incomplete-jack': 0,
    'low-knee-lift': 0,
    'knees-caving': 0,
    'arms-dropped': 0,
    'leg-not-straight': 0,
    'top-arm-not-vertical': 0,
    'bottom-arm-not-down': 0,
    'arms-too-high': 0,
    'arms-forward-not-side': 0,
    'arms-out-not-front': 0,
    'heel-dropped': 0,
    'arms-not-overhead': 0,
    'low-leg-raise': 0,
    'incomplete-bend': 0,
    'incomplete-stand': 0,
    'torso-not-level': 0,
    'back-leg-low': 0,
    'legs-dropped': 0,
    'chest-dropped': 0,
    'not-folded-enough': 0,
    'chest-not-lifted': 0,
    'shallow-spine-rom': 0,
    'arms-not-straight': 0,
    'rounded-back': 0,
    'hips-shooting-up': 0,
    'incomplete-deadlift': 0,
    'shoulder-shrug': 0,
    'incomplete-pullup': 0,
    'lower-back-arch': 0,
    'bar-path-drift': 0,
    'incomplete-press': 0,
    'row-momentum': 0,
    'incomplete-row': 0,
    'rdl-back-rounded': 0,
    'excessive-knee-bend': 0,
    'incomplete-rdl': 0,
    // New exercises (Bilal's round 2)
    'above-parallel': 0,
    'arm-lift': 0,
    'goblet-elbows-collapsing': 0,
    'hip-drop': 0,
    'hip-lift-off': 0,
    'hip-rotation-curtsy': 0,
    'incomplete-bird-dog': 0,
    'incomplete-bridge': 0,
    'incomplete-clamshell': 0,
    'incomplete-curtsy-lunge': 0,
    'incomplete-dead-bug': 0,
    'incomplete-dip': 0,
    'incomplete-donkey-kick': 0,
    'incomplete-drive': 0,
    'incomplete-extension': 0,
    'incomplete-fire-hydrant': 0,
    'incomplete-goblet-squat': 0,
    'incomplete-inchworm': 0,
    'incomplete-jump': 0,
    'incomplete-jump-squat': 0,
    'incomplete-nordic-curl': 0,
    'incomplete-pallof-press': 0,
    'incomplete-pistol-squat': 0,
    'incomplete-plank': 0,
    'incomplete-reverse-fly': 0,
    'incomplete-shrug': 0,
    'incomplete-star-jump': 0,
    'incomplete-step-up': 0,
    'incomplete-superman': 0,
    'incomplete-tricep-extension': 0,
    'incomplete-walking-lunge': 0,
    'knee-valgus': 0,
    'no-jump': 0,
    'no-loading': 0,
    'squat-pattern': 0,
    'steps-not-tracked': 0,
    'stiff-landing': 0,
    'torso-rotation-pallof': 0,
    'trunk-lean': 0,
  };
}

function makeSet(setNumber: number, plannedReps: number): SetRecord {
  return {
    setNumber,
    plannedReps,
    reps: [],
    mqs: 0,
    warningCounts: emptyWarningCounts(),
    startedAt: Date.now(),
  };
}

function makeHoldRecord(targetSec: number): HoldRecord {
  return {
    targetDurationSec: targetSec,
    actualDurationSec: 0,
    averageMqs: 0,
    warningCounts: emptyWarningCounts(),
    formTimeSeries: [],
    startedAt: Date.now(),
    broken: false,
    longestUnfrozenSec: 0,
  };
}

export const useWorkout = create<WorkoutState>((set, get) => ({
  exercise: null,
  setup: null,
  status: 'idle',
  currentSetIndex: 0,
  sets: [],
  restEndsAt: null,
  holdRecord: null,
  workoutStartedAt: null,
  workoutEndedAt: null,
  manuallyEnded: false,

  initWorkout: (exercise, setup) => {
    const isHold = exercise.exerciseType === 'hold-based';
    set({
      exercise,
      setup,
      status: 'tracking',
      currentSetIndex: 0,
      sets: isHold ? [] : [makeSet(1, setup.plannedRepsPerSet ?? 0)],
      holdRecord: isHold ? makeHoldRecord(setup.holdDurationSec ?? 30) : null,
      workoutStartedAt: Date.now(),
      workoutEndedAt: null,
      restEndsAt: null,
      manuallyEnded: false,
    });
  },

  // ─── Rep-based ─────────────────────────────────────────────
  recordRep: (rep) => {
    const state = get();
    const currentSet = state.sets[state.currentSetIndex];
    if (!currentSet) return;

    const repRecord: RepRecord = {
      ...rep,
      index: currentSet.reps.length + 1,
      timestamp: Date.now(),
    };

    const updatedWarningCounts = { ...currentSet.warningCounts };
    for (const w of rep.warnings) {
      updatedWarningCounts[w] = (updatedWarningCounts[w] ?? 0) + 1;
    }

    const updatedReps = [...currentSet.reps, repRecord];
    const updatedMqs =
      updatedReps.reduce((sum, r) => sum + r.mqs, 0) / updatedReps.length;

    const updatedSet: SetRecord = {
      ...currentSet,
      reps: updatedReps,
      mqs: updatedMqs,
      warningCounts: updatedWarningCounts,
    };

    const updatedSets = [...state.sets];
    updatedSets[state.currentSetIndex] = updatedSet;
    set({ sets: updatedSets });
  },

  completeSet: () => {
    const state = get();
    const currentSet = state.sets[state.currentSetIndex];
    if (!currentSet) return;

    const updatedSets = [...state.sets];
    updatedSets[state.currentSetIndex] = { ...currentSet, completedAt: Date.now() };
    set({ sets: updatedSets });
  },

  startRest: () => {
    const state = get();
    if (!state.setup?.restSec) return;
    set({
      status: 'resting',
      restEndsAt: Date.now() + state.setup.restSec * 1000,
    });
  },

  skipRest: () => {
    set({ restEndsAt: Date.now() });
    get().beginNextSet();
  },

  beginNextSet: () => {
    const state = get();
    if (!state.setup?.plannedSets) return;
    const nextIndex = state.currentSetIndex + 1;
    if (nextIndex >= state.setup.plannedSets) {
      get().finishWorkout();
      return;
    }
    const updatedSets = [
      ...state.sets,
      makeSet(nextIndex + 1, state.setup.plannedRepsPerSet ?? 0),
    ];
    set({
      currentSetIndex: nextIndex,
      sets: updatedSets,
      status: 'tracking',
      restEndsAt: null,
    });
  },

  // ─── Hold-based ────────────────────────────────────────────
  recordHoldTick: (mqs, secondsElapsed, longestUnfrozenSec, warning) => {
    const state = get();
    if (!state.holdRecord) return;
    const updatedWarningCounts = warning
      ? { ...state.holdRecord.warningCounts, [warning]: state.holdRecord.warningCounts[warning] + 1 }
      : state.holdRecord.warningCounts;
    const updatedSeries = [...state.holdRecord.formTimeSeries, { t: secondsElapsed, mqs }];
    const updatedAvg = updatedSeries.reduce((s, x) => s + x.mqs, 0) / updatedSeries.length;
    set({
      holdRecord: {
        ...state.holdRecord,
        actualDurationSec: secondsElapsed,
        averageMqs: updatedAvg,
        formTimeSeries: updatedSeries,
        warningCounts: updatedWarningCounts,
        longestUnfrozenSec: longestUnfrozenSec ?? state.holdRecord.longestUnfrozenSec,
      },
    });
  },

  completeHold: (broken) => {
    const state = get();
    if (!state.holdRecord) return;
    set({
      holdRecord: {
        ...state.holdRecord,
        completedAt: Date.now(),
        broken,
      },
    });
    get().finishWorkout();
  },

  // ─── Shared ────────────────────────────────────────────────
  finishWorkout: () => {
    set({
      status: 'complete',
      workoutEndedAt: Date.now(),
      restEndsAt: null,
    });
  },

  reset: () => {
    set({
      exercise: null,
      setup: null,
      status: 'idle',
      currentSetIndex: 0,
      sets: [],
      holdRecord: null,
      workoutStartedAt: null,
      workoutEndedAt: null,
      restEndsAt: null,
      manuallyEnded: false,
    });
  },

  manualEndWorkout: () => {
    // Mark workout as manually ended, then run the standard finishWorkout flow.
    // sets / holdRecord remain intact so the report can show partial stats.
    set({ manuallyEnded: true });
    get().finishWorkout();
  },

  playAgain: () => {
    // Preserve exercise + setup; wipe all scoring state. Status flips to 'tracking'
    // so the play page boots straight into calibration → workout.
    const state = get();
    if (!state.exercise || !state.setup) return;
    const isHold = state.exercise.exerciseType === 'hold-based';
    set({
      status: 'tracking',
      currentSetIndex: 0,
      sets: isHold ? [] : [makeSet(1, state.setup.plannedRepsPerSet ?? 0)],
      holdRecord: isHold ? makeHoldRecord(state.setup.holdDurationSec ?? 30) : null,
      workoutStartedAt: Date.now(),
      workoutEndedAt: null,
      restEndsAt: null,
      manuallyEnded: false,
    });
  },
}));
