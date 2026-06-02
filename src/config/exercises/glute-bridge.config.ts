import type { ExerciseConfig } from './types';

export const gluteBridgeConfig: ExerciseConfig = {
  id: 'glute-bridge',
  catalogCode: 'A8',
  name: 'Glute Bridge',
  category: 'bodyweight',
  equipment: ['Bodyweight'],
  primaryMuscles: ['Gluteus Maximus'],
  secondaryMuscles: ['Hamstrings', 'Core', 'Hip Flexors'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Hip extension height', 'Form'],
  instructions: [
    'Lie on your back with knees bent, feet flat on the floor hip-width apart.',
    'Arms relaxed at your sides, palms facing down.',
    'Drive your hips upward by squeezing your glutes hard.',
    'Raise until your body forms a straight line from shoulders to knees.',
    'Hold briefly at the top — no lower-back hyperextension.',
    'Lower your hips with control back to the floor. Repeat.',
  ],
  commonErrors: [
    { error: 'Lower back arching instead of hip extension', cameraDetection: 'Hip vs shoulder-knee midline at peak' },
    { error: 'Incomplete hip extension — not reaching full height', cameraDetection: 'Hip landmark height vs calibration baseline' },
    { error: 'Pushing through toes instead of heels', cameraDetection: 'Heel position during extension' },
    { error: 'Knees flaring out at the top', cameraDetection: 'Knee width vs baseline' },
  ],
  breathing: 'Inhale at rest → exhale on the drive up → inhale on the way down.',
  modifications: {
    easier: ['Reduced-range bridge', 'Single-leg glute bridge (easier variation)', 'Feet elevated'],
    harder: ['Single-leg glute bridge', 'Hip thrust with barbell', 'Pause bridge (3s hold)'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 12,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower-back or hip pain',
    'I have no recent knee or ankle injury',
  ],

  engineModule: 'glute-bridge',

  images: {
    hero: 'svg:glute-bridge-hero',
    steps: ['svg:glute-bridge-rest', 'svg:glute-bridge-top'],
  },
  videoUrl: undefined,
};
