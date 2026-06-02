import type { ExerciseConfig } from './types';

export const fireHydrantConfig: ExerciseConfig = {
  id: 'fire-hydrant',
  catalogCode: 'C-FH',
  name: 'Fire Hydrant',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Gluteus Medius'],
  secondaryMuscles: ['Gluteus Maximus', 'Hip Abductors', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps'],
  instructions: [
    'Start on all fours — hands directly below shoulders, knees below hips. Back flat, neutral spine.',
    'Brace your core. Keep your hips level throughout — do NOT let them rotate or tilt.',
    'Keeping the knee bent at 90°, lift your right knee outward to the side.',
    'Raise until the thigh is roughly parallel to the floor (or as high as comfortable).',
    'Hold briefly at the top, squeezing the glute medius.',
    'Lower with control back to the starting position. Complete all reps on one side, then switch.',
  ],
  commonErrors: [
    { error: 'Hips rotating or tilting to one side', cameraDetection: 'Left/right hip Y asymmetry during lift' },
    { error: 'Incomplete lift (thigh not reaching near-horizontal)', cameraDetection: 'Peak thighLiftDeg < 35°' },
    { error: 'Rushing the movement (ballistic kick)', cameraDetection: 'Rep duration < 500ms' },
    { error: 'Using momentum instead of controlled glute contraction', cameraDetection: 'High hip velocity detected' },
  ],
  breathing: 'Exhale as you lift the knee out → inhale as you lower back to start.',
  modifications: {
    easier: ['Reduce range of motion — stop at 30°', 'Slow tempo (3s up, 3s down)', 'Use a mirror for form feedback'],
    harder: ['Add resistance band above the knee', 'Pause 2 seconds at the top', 'Add ankle weights'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 12,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute hip or lower-back pain',
    'I have no wrist pain preventing weight-bearing on my hands',
    'I have no recent knee injury that prevents kneeling',
  ],
  engineModule: 'fire-hydrant',
  images: {
    hero: 'svg:fire-hydrant-hero',
    steps: ['svg:fire-hydrant-start', 'svg:fire-hydrant-top'],
  },
  videoUrl: undefined,
};
