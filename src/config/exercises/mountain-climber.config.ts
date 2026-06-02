import type { ExerciseConfig } from './types';

export const mountainClimberConfig: ExerciseConfig = {
  id: 'mountain-climber',
  catalogCode: 'C-MC',
  name: 'Mountain Climber',
  category: 'bodyweight',
  equipment: [],
  primaryMuscles: ['Core', 'Hip Flexors'],
  secondaryMuscles: ['Shoulders', 'Quads', 'Glutes'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Pace'],
  instructions: [
    'Start in a high plank: hands under shoulders, arms extended, body straight head to heels.',
    'Stand side-on to the camera so your full body is visible horizontally.',
    'Brace your core. Keep hips level — do not let them sag or pike.',
    'Drive one knee toward your chest. Return to plank. Each knee drive = 1 rep.',
    'Keep shoulders stable. Do not bounce your hips with each drive.',
  ],
  commonErrors: [
    { error: 'Hips sagging', cameraDetection: 'Hip drops below shoulder-to-ankle midline' },
    { error: 'Hips piking up', cameraDetection: 'Hip rises above shoulder-to-ankle midline' },
    { error: 'Incomplete knee drive', cameraDetection: 'Knee does not reach 70° hip-knee angle' },
  ],
  breathing: 'Exhale on each knee drive. Keep breathing rhythmically.',
  modifications: {
    easier: ['Slow mountain climbers (3s each drive)', 'Incline mountain climbers (hands on bench)'],
    harder: ['Cross-body mountain climbers', 'Spider mountain climbers', 'HIIT pace (maximum speed)'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 20,
  defaultRestSec: 45,
  safetyChecks: [
    'I have no wrist pain or shoulder impingement',
    'I can hold a plank for 30 seconds before attempting mountain climbers',
  ],
  engineModule: 'mountain-climber',
  images: { hero: 'svg:mc-hero', steps: ['svg:mc-plank', 'svg:mc-drive', 'svg:mc-return'] },
  videoUrl: '',
};
