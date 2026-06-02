import type { ExerciseConfig } from './types';

export const catCowConfig: ExerciseConfig = {
  id: 'cat-cow',
  catalogCode: 'J14 — Cat-Cow',
  name: 'Cat-Cow',
  category: 'mobility',
  equipment: ['None'],
  primaryMuscles: ['Spinal erectors', 'Abdominals', 'Neck flexors/extensors'],
  secondaryMuscles: ['Shoulders', 'Hip flexors', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (cycles)', 'Spine range'],
  instructions: [
    'Set up on hands and knees with your SIDE to the camera — wrists under shoulders, knees under hips, back flat and level.',
    'Cow: inhale, drop your belly, lift your chest and gaze, and tilt your tailbone up — let your head/chin rise.',
    'Cat: exhale, round your spine toward the ceiling, tuck your chin to your chest and your tailbone under.',
    'Flow smoothly between the two, leading with your head — a big arch, then a big round. That is one rep.',
    'Move slowly with your breath through a full, comfortable range. Keep your hips over your knees (do not rock forward and back).',
  ],
  commonErrors: [
    { error: 'Barely moving — tiny range', cameraDetection: 'Head/neck pitch swing too small (cow OR cat below ~15°) fires shallow-spine-rom (rep not counted)' },
    { error: 'Flinging the head fast', cameraDetection: 'Very high nose velocity / sub-1 s cycle triggers malformed-rep' },
    { error: 'Rocking the hips forward and back', cameraDetection: 'Hip drift from the calibrated position penalizes the form score' },
  ],
  breathing: 'Inhale into the COW (arch), exhale into the CAT (round). Let the breath set a slow, even pace.',
  modifications: {
    easier: ['Smaller range of motion', 'Forearms down (sphinx-style) if wrists hurt', 'Slower tempo'],
    harder: ['Fuller arch and round each rep', 'Add a slow side-bend (wag the tail) on alternate sets', 'Longer holds at each end'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 2,
  defaultRepsPerSet: 8,
  defaultRestSec: 20,
  safetyChecks: [
    'I have no acute neck, wrist, or lower-back injury',
    'I can kneel on all fours comfortably (a mat/cushion under the knees if needed)',
    'I have no condition that makes moving my head up and down unsafe (e.g. vertigo)',
  ],

  engineModule: 'cat-cow',

  images: {
    hero: 'svg:cat-cow-hero',
    steps: ['svg:cat-cow-hero'],
  },
  videoUrl: 'https://youtu.be/LIVJZZyZ2qM',
};
