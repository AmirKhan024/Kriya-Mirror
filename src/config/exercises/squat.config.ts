import type { ExerciseConfig } from './types';

export const squatConfig: ExerciseConfig = {
  id: 'squat',
  catalogCode: 'A1 / C2',
  name: 'Bodyweight Squat',
  category: 'bodyweight',
  equipment: ['Barbell + rack', 'Dumbbell', 'Bodyweight'],
  primaryMuscles: ['Quadriceps', 'Glutes', 'Hamstrings'],
  secondaryMuscles: ['Erector Spinae', 'Core', 'Adductors'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Depth (parallel / ATG)', 'Tempo'],
  instructions: [
    'Stand with feet shoulder-width apart, toes pointed slightly out (15–30°).',
    'Take a big breath into your belly and brace your core.',
    'Initiate descent by pushing knees out over toes. Break at hips and knees simultaneously.',
    'Lower until thighs are parallel to floor. Maintain a neutral spine throughout.',
    'Drive through mid-foot, extend hips and knees back to standing.',
    'Exhale at the top. Repeat.',
  ],
  commonErrors: [
    { error: 'Knees caving inward (valgus collapse)', cameraDetection: 'Knee-to-foot alignment vs hip width' },
    { error: 'Heels rising off the floor', cameraDetection: 'Ankle landmark vs floor plane' },
    { error: 'Excessive forward lean (torso angle > 45°)', cameraDetection: 'Hip–shoulder angle calculation' },
    { error: 'Butt wink (pelvic tuck at bottom)', cameraDetection: 'Hip landmark vs lumbar curve' },
    { error: 'Shallow depth — not reaching parallel', cameraDetection: 'Hip landmark height vs knee height' },
  ],
  breathing: 'Inhale & brace before descent → hold through sticking point → exhale at top.',
  modifications: {
    easier: ['Goblet squat', 'Box squat', 'Chair squat'],
    harder: ['Pause squat (2–3s bottom)', 'Tempo squat (3-1-1)', 'Bulgarian split squat'],
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
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute knee pain or injury',
    'I have no hip labral or ankle instability issues',
    'I have no severe lower-back pain or recent spinal injury',
  ],

  engineModule: 'squat',

  images: {
    hero: 'svg:squat-hero',
    steps: ['svg:squat-stand', 'svg:squat-descend', 'svg:squat-bottom'],
  },
  videoUrl: 'https://youtube.com/shorts/SLOkdLLWj8A',
};
