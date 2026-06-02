import type { ExerciseConfig } from './types';

export const conventionalDeadliftConfig: ExerciseConfig = {
  id: 'conventional-deadlift',
  catalogCode: 'S1',
  name: 'Conventional Deadlift',
  category: 'strength-compound',
  equipment: ['Barbell', 'Dumbbells', 'Kettlebell', 'Resistance Band'],
  primaryMuscles: ['Hamstrings', 'Glutes', 'Erector Spinae'],
  secondaryMuscles: ['Quadriceps', 'Trapezius', 'Forearms', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Hip Hinge Depth', 'Tempo'],
  instructions: [
    'Stand side-on to the camera. Feet hip-width apart, toes slightly out.',
    'Hinge at the hips — push them back while keeping your back straight.',
    'Lower until your torso is roughly parallel to the floor (or as deep as mobility allows).',
    'Keep the bar close to your body. Drive through your heels to stand back up.',
    'Hips and shoulders rise together — do not let the hips shoot up first.',
    'Lock out at the top: squeeze glutes, stand tall. Do not hyperextend the lower back.',
  ],
  commonErrors: [
    { error: 'Rounded lower back (spine flexion under load)', cameraDetection: 'Shoulder drops below hip level — torso angle vs landmark delta' },
    { error: 'Hips shooting up first (good-morning fault)', cameraDetection: 'Hip y-velocity > 2.5× shoulder y-velocity during extension' },
    { error: 'Incomplete range — not hinging deep enough', cameraDetection: 'Peak hip-hinge angle < 45°' },
    { error: 'Hyperextension at lockout', cameraDetection: 'Torso angle past neutral at top — disabled in side-camera (unsafe to infer)' },
    { error: 'Bar drifting away from body', cameraDetection: 'Side-camera wrist path drift — qualitative note only' },
  ],
  breathing: 'Big breath in and brace before hinging → hold through the pull → exhale at lockout.',
  modifications: {
    easier: ['Romanian Deadlift (partial ROM)', 'Dumbbell deadlift', 'Trap-bar deadlift', 'Kettlebell deadlift'],
    harder: ['Deficit deadlift (stand on plate)', 'Sumo deadlift', 'Pause deadlift (2s off floor)', 'Snatch-grip deadlift'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 5,
  defaultRestSec: 90,
  safetyChecks: [
    'I have no acute lower back pain or recent spinal injury',
    'I have no hip or hamstring strain that limits full hinging',
    'I understand how to brace my core before lifting',
  ],

  engineModule: 'conventional-deadlift',

  images: {
    hero: 'svg:deadlift-hero',
    steps: ['svg:deadlift-stand', 'svg:deadlift-hinge', 'svg:deadlift-bottom'],
  },
  videoUrl: '',
};
