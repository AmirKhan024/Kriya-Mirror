import type { ExerciseConfig } from './types';

export const jumpSquatConfig: ExerciseConfig = {
  id: 'jump-squat',
  catalogCode: 'C2',
  name: 'Jump Squat',
  category: 'functional',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps', 'Glutes', 'Calves'],
  secondaryMuscles: ['Core', 'Hamstrings'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Jump height (hip rise)', 'Landing quality'],
  instructions: [
    'Stand facing the camera with feet shoulder-width apart.',
    'Dip into a quarter squat — bend your knees and load your legs.',
    'Explode upward and jump as high as possible.',
    'Land softly with knees bent to absorb the impact.',
    'Reset and repeat.',
  ],
  commonErrors: [
    { error: 'No loading dip before jump', cameraDetection: 'AIRBORNE state entered without LOADING state' },
    { error: 'Stiff-legged landing', cameraDetection: 'Knee flexion stays < 20° for 300ms after landing' },
    { error: 'Insufficient jump height', cameraDetection: 'Hip Y displacement < minimum threshold' },
    { error: 'Landing on heels', cameraDetection: 'Rapid hip descent without prior absorption phase' },
  ],
  breathing: 'Exhale explosively on the jump. Inhale on the way down.',
  modifications: {
    easier: ['Squat in place before progressing to full jump', 'Reduce jump intensity'],
    harder: ['Add a pause at the bottom before each jump', 'Wear a weighted vest'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: false,
    cameraVision: 'full',
  },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no knee or hip joint issues',
    'I am wearing appropriate footwear for jumping',
  ],
  engineModule: 'jump-squat',
  images: {
    hero: 'svg:jump-squat-hero',
    steps: ['svg:jump-squat-standing', 'svg:jump-squat-top'],
  },
};
