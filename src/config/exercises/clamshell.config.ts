import type { ExerciseConfig } from './types';

export const clamshellConfig: ExerciseConfig = {
  id: 'clamshell',
  catalogCode: 'C-CLM',
  name: 'Clamshell',
  category: 'senior-rehab',
  equipment: [],
  primaryMuscles: ['Glute Medius'],
  secondaryMuscles: ['Glute Minimus', 'Hip External Rotators'],
  difficulty: 'Beginner',
  trackFields: ['Reps', 'Open Fraction'],
  instructions: [
    'Lie on your side with hips stacked and knees bent about 45°.',
    'Rest your head on your bottom arm. Keep your feet together throughout.',
    'Keeping your feet touching, rotate your top knee upward like a clamshell opening.',
    'Raise as high as you can without letting your pelvis rock backward.',
    'Slowly lower back to the start position.',
  ],
  commonErrors: [
    { error: 'Pelvis rolling backward', cameraDetection: 'Hip X displacement > 5% during opening phase' },
    { error: 'Not achieving full range of motion at the top', cameraDetection: 'Knee gap fraction < 0.6 at peak' },
    { error: 'Feet separating during the movement', cameraDetection: 'Ankle Y divergence > 0.04 from baseline' },
  ],
  breathing: 'Exhale as you open — inhale as you lower.',
  modifications: {
    easier: ['Reduce range of motion', 'Use lighter resistance band'],
    harder: ['Add a resistance band just above the knees'],
  },
  guidanceModes: { imageText: true, videoAudio: false, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 15,
  defaultRestSec: 60,
  safetyChecks: [
    'Safe for most users. Stop if you feel hip joint pain.',
    'A good rehabilitation exercise — often used in knee rehab protocols.',
  ],
  engineModule: 'clamshell',
  images: { hero: 'svg:clamshell-hero', steps: [] },
  videoUrl: undefined,
};
