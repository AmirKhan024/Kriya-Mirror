import type { ExerciseConfig } from './types';

export const sideLegRaiseConfig: ExerciseConfig = {
  id: 'side-leg-raise',
  catalogCode: 'B20 — Hip Abduction',
  name: 'Standing Side Leg Raise',
  category: 'strength-isolation',
  equipment: ['Bodyweight'],
  primaryMuscles: ['Gluteus Medius'],
  secondaryMuscles: ['Gluteus Minimus', 'Tensor Fasciae Latae', 'Core (stabilizer)'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (each side)', 'Abduction angle'],
  instructions: [
    'Stand tall facing the camera, feet hip-width apart. Rest a hand on a wall or chair if you need balance.',
    'Keeping your standing leg straight and your torso upright, lift one leg straight out to the side.',
    'Lead with your heel, keep the lifting leg straight, and raise it as high as is comfortable (around 30–45°).',
    'Lower the leg back down with control until your feet are together again.',
    'Do all your reps on one side, then switch — or alternate. Keep your hips level and do not lean your torso.',
    'Breathe out as you lift, in as you lower.',
  ],
  commonErrors: [
    { error: 'Leg barely lifting (half-rep)', cameraDetection: 'Peak hip abduction < 22° fires low-leg-raise' },
    { error: 'Swinging the leg up with momentum', cameraDetection: 'Rep duration < 300 ms or high ankle velocity triggers malformed-rep' },
    { error: 'Leaning the torso to hike the leg', cameraDetection: 'Shoulder-midpoint x drift is tracked and penalizes the form score' },
    { error: 'Hips not staying level', cameraDetection: 'Lifting-side hip rise tracked via the abduction-angle baseline' },
  ],
  breathing: 'Exhale as you raise the leg, inhale as you lower it. Keep the movement slow and controlled.',
  modifications: {
    easier: ['Hold a wall or chair for balance', 'Smaller range of motion', 'Lying side leg raise (on the floor)'],
    harder: ['Add an ankle weight', 'Pause 2s at the top of each rep', 'Resistance band around the ankles'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 45,
  safetyChecks: [
    'I have no acute hip pain or recent hip injury',
    'I can stand on one leg without significant balance loss (or I have a wall/chair nearby)',
    'I have no lower-back pain that worsens when lifting a leg to the side',
  ],

  engineModule: 'side-leg-raise',

  images: {
    hero: 'svg:side-leg-raise-hero',
    steps: ['svg:side-leg-raise-hero', 'svg:side-leg-raise-up', 'svg:side-leg-raise-shallow'],
  },
  videoUrl: 'https://youtube.com/shorts/omGuWt_eprg',
};
