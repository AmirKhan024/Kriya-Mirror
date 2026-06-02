import type { ExerciseConfig } from './types';

export const burpeeConfig: ExerciseConfig = {
  id: 'burpee',
  catalogCode: 'C-BRP',
  name: 'Burpee',
  category: 'bodyweight',
  equipment: [],
  primaryMuscles: ['Quadriceps', 'Glutes', 'Chest', 'Shoulders', 'Core'],
  secondaryMuscles: ['Triceps', 'Calves', 'Hip Flexors'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Time', 'Jump quality'],
  instructions: [
    'Stand side-on to the camera, feet shoulder-width.',
    'Squat down and place hands on floor. Jump or step feet back to a high plank.',
    'Perform a push-up (optional). Jump or step feet forward back to squat.',
    'Jump explosively. Arms swing overhead. Land softly.',
    'Each full cycle (stand → plank → stand + jump) = 1 rep.',
  ],
  commonErrors: [
    {
      error: 'Skipping the jump at the top',
      cameraDetection: 'Hip never rises above standing baseline',
    },
    {
      error: 'Not reaching full plank position',
      cameraDetection: 'Hip never reaches PLANK_ENTER threshold',
    },
    {
      error: 'Hips sagging in plank',
      cameraDetection: 'Hip drops below shoulder-to-ankle midline during plank phase',
    },
  ],
  breathing: 'Exhale on the jump and on the push-up. Inhale on the descent.',
  modifications: {
    easier: [
      'No-jump burpee (step instead of jump)',
      'Incline burpee (hands on bench)',
      'Half burpee (no push-up)',
    ],
    harder: [
      'Jump onto a box',
      'Burpee with tuck jump',
      'Weighted burpee',
    ],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no wrist or shoulder injuries',
    'I can perform a plank and a squat with good form individually',
    'I have adequate cardiovascular conditioning for high-intensity work',
  ],
  engineModule: 'burpee',
  images: {
    hero: 'svg:burpee-hero',
    steps: ['svg:burpee-stand', 'svg:burpee-squat', 'svg:burpee-plank', 'svg:burpee-jump'],
  },
  videoUrl: '',
};
