import type { ExerciseConfig } from './types';

export const supermanConfig: ExerciseConfig = {
  id: 'superman',
  catalogCode: 'C3',
  name: 'Superman',
  category: 'bodyweight',
  equipment: ['None (floor)'],
  primaryMuscles: ['Erector Spinae', 'Glutes'],
  secondaryMuscles: ['Hamstrings', 'Rear Deltoids'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Alignment'],
  instructions: [
    'Lie face-down on the floor, arms extended overhead, legs straight.',
    'Keep your neck neutral — look at the floor throughout.',
    'Simultaneously lift your chest and legs off the floor, squeezing glutes and back.',
    'Hold briefly at the top, then lower with control.',
    'Do not jerk — smooth controlled movement on every rep.',
  ],
  commonErrors: [
    { error: 'Not lifting chest high enough', cameraDetection: 'Shoulder Y delta from baseline does not reach AT_TOP_THRESHOLD=0.06' },
    { error: 'Jerking up ballistically', cameraDetection: 'Rep duration < 400ms triggers malformed-rep' },
    { error: 'Lifting hips off floor (arching lower back)', cameraDetection: 'Hip Y rises above HIP_LIFT_THRESHOLD=0.04 from calibrated floor' },
    { error: 'Moving too fast (ballistic)', cameraDetection: 'Shoulder velocity exceeds MAX_SHOULDER_VELOCITY=3.0' },
  ],
  breathing: 'Exhale as you lift. Inhale as you lower.',
  modifications: {
    easier: ['Lift arms only', 'Lift legs only', 'Reduced range of motion'],
    harder: ['Hold at top for 3 seconds', 'Add ankle weights', 'Eyes closed'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 12,
  defaultRestSec: 45,
  safetyChecks: [
    'I have no lower-back injuries',
    'I can lie prone comfortably',
  ],
  engineModule: 'superman',
  images: {
    hero: 'svg:superman-hero',
    steps: ['svg:superman-prone', 'svg:superman-top'],
  },
  videoUrl: undefined,
};
