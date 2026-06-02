import type { ExerciseConfig } from './types';

export const starJumpConfig: ExerciseConfig = {
  id: 'star-jump',
  catalogCode: 'C1',
  name: 'Star Jump (Jumping Jack)',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps', 'Shoulders', 'Calves'],
  secondaryMuscles: ['Glutes', 'Hip Abductors', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Arm elevation', 'Leg spread'],
  instructions: [
    'Stand tall facing the camera. Feet together, arms at your sides.',
    'Jump both feet wide while simultaneously raising both arms overhead.',
    'Arms should reach fully overhead — hands meet or cross above your head.',
    'Jump feet back together while lowering arms to your sides with control.',
    'Maintain a consistent rhythm. Avoid ballistic or jerky movements.',
  ],
  commonErrors: [
    { error: 'Arms not reaching overhead', cameraDetection: 'Wrist Y does not rise sufficiently above shoulder Y' },
    { error: 'Incomplete leg spread', cameraDetection: 'Ankle width does not widen adequately from calibration baseline' },
    { error: 'Arms and legs out of sync', cameraDetection: 'Arm elevation peak misaligned with leg spread peak' },
    { error: 'Ballistic / too-fast reps', cameraDetection: 'Wrist Y velocity exceeds 4.0 normalized units/s' },
  ],
  breathing: 'Exhale on the jump out. Inhale on the return.',
  modifications: {
    easier: ['Step-jack (step side-to-side instead of jumping)', 'Low-impact jack (one foot at a time)', 'Half-range arms to shoulder level only'],
    harder: ['Weighted star jump (light dumbbells)', 'Plyo star jump (extra height)', 'Star jump into burpee'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 20,
  defaultRestSec: 45,
  safetyChecks: [
    'I have no knee or hip joint issues',
    'I am wearing appropriate footwear for jumping',
  ],
  engineModule: 'star-jump',
  images: { hero: 'svg:star-jump-hero', steps: ['svg:star-jump-down', 'svg:star-jump-top'] },
  videoUrl: '',
};
