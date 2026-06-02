import type { ExerciseConfig } from './types';

/**
 * 2026-05-28 round 22: re-architected from REP-based ("up-down-up-down" reps)
 * to HOLD-based ("rise once + hold"). User physical-testing determined the
 * rep-cycling concept was wrong for calf raise — and MediaPipe ankle
 * detection asymmetry rejected most valid reps. New model mirrors BB6
 * heel-rise-hold (kriya-activities/balance_new) — pivot to a static hold.
 */
export const calfRaiseConfig: ExerciseConfig = {
  id: 'calf-raise',
  catalogCode: 'B12',
  name: 'Calf Raise',
  category: 'strength-isolation',
  equipment: ['Bodyweight', 'Dumbbells', 'Calf-raise machine', 'Step / deficit block'],
  primaryMuscles: ['Gastrocnemius', 'Soleus'],
  secondaryMuscles: ['Tibialis posterior', 'Peroneals', 'Foot intrinsics'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Heel-drop count', 'Steadiness'],
  instructions: [
    'Stand facing the camera with feet about shoulder-width apart, arms relaxed at your sides.',
    'Rise UP onto the balls of both feet — heels off the floor as high as you can.',
    'HOLD that position. Keep your torso upright, knees straight, eyes forward.',
    'The timer starts the moment you rise. If your heels drop, the timer pauses — rise back up to resume.',
    'Breathe steadily. Hold for the target duration.',
  ],
  commonErrors: [
    { error: 'Heels dropping mid-hold', cameraDetection: 'Timer pauses + heel-dropped warning (cooldown-throttled). Resumes on recovery.' },
    { error: 'Knees buckling forward', cameraDetection: 'Form-score penalty via trunk-lean tracking.' },
    { error: 'Excessive side-to-side sway', cameraDetection: 'Steadiness sub-score drops as shoulder-mid X variance grows.' },
  ],
  breathing: 'Steady, controlled breathing throughout the hold — do not hold your breath.',
  modifications: {
    easier: ['Wall-supported (fingertips touch wall for balance)', 'Shorter target hold (10-15 s)'],
    harder: ['Single-leg heel-rise hold', 'Eyes closed (balance challenge)', 'Longer target hold (45-60 s)'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'hold-based',
  isStrength: false,
  defaultSets: 0,
  defaultRepsPerSet: 0,
  defaultRestSec: 0,
  defaultHoldDurationSec: 20,
  minHoldDurationSec: 10,
  safetyChecks: [
    'I have no acute Achilles tendon pain or recent injury',
    'I have no plantar fasciitis flare-up that prevents weight-bearing on the toes',
    'I can balance on the balls of my feet without dizziness',
  ],

  engineModule: 'calf-raise',

  images: {
    hero: 'svg:calf-raise-hero',
    steps: ['svg:calf-raise-down', 'svg:calf-raise-up'],
  },
  videoUrl: 'https://youtube.com/shorts/fOfPwmb5FXU?si=2K91cDusQxvom2E6',

  // 2026-06-02: soft-deprecated (hidden from the home catalog). Code, engine,
  // route, and tests all stay intact — flip to `true` (or delete this line) to
  // bring it back.
  isVisible: false,
};
