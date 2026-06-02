import type { ExerciseConfig } from './types';

export const shrugConfig: ExerciseConfig = {
  id: 'shrug',
  catalogCode: 'C4',
  name: 'Shrug',
  category: 'strength-isolation',
  equipment: ['Dumbbells', 'Barbell'],
  primaryMuscles: ['Trapezius'],
  secondaryMuscles: ['Levator Scapulae', 'Rhomboids'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Shoulder elevation'],
  instructions: [
    'Stand facing the camera, feet shoulder-width, arms at sides holding weights.',
    'Keep your core tight and spine neutral throughout.',
    'Raise your shoulders straight up toward your ears — do not roll them forward or back.',
    'Hold at the top for one count, feeling the trap contraction.',
    'Lower with control. Reset and repeat.',
  ],
  commonErrors: [
    { error: 'Rolling shoulders forward or backward', cameraDetection: 'Torso swing detected via hip X lateral displacement' },
    { error: 'Not shrugging high enough', cameraDetection: 'Peak shoulder elevation < 0.035 fires incomplete-shrug' },
    { error: 'Ballistic/momentum shrug', cameraDetection: 'Shoulder velocity > 3.5 nu/sec triggers malformed-rep' },
  ],
  breathing: 'Exhale as you shrug up. Inhale as you lower.',
  modifications: {
    easier: ['Lighter dumbbells', 'Bodyweight shrug'],
    harder: ['Barbell shrug', 'Single-arm dumbbell shrug', 'Behind-the-back barbell shrug'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 15,
  defaultRestSec: 45,
  safetyChecks: [
    'I have no neck or shoulder impingement',
    'I am using an appropriate weight for controlled reps',
  ],

  engineModule: 'shrug',

  images: {
    hero: 'svg:shrug-hero',
    steps: ['svg:shrug-standing', 'svg:shrug-top'],
  },
};
