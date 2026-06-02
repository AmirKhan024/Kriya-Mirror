import type { ExerciseConfig } from './types';

export const kettlebellSwingConfig: ExerciseConfig = {
  id: 'kettlebell-swing',
  catalogCode: 'D1',
  name: 'Kettlebell Swing',
  category: 'functional',
  equipment: ['Kettlebell'],
  primaryMuscles: ['Glutes', 'Hamstrings'],
  secondaryMuscles: ['Core', 'Lats', 'Erector Spinae', 'Shoulders (passive)'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Hip snap quality', 'Back angle'],
  instructions: [
    'Stand side-on to the camera, feet slightly wider than hip-width. KB between feet.',
    'Hip hinge to grip KB. Neutral spine, lats engaged. This is NOT a squat.',
    'Hike KB back between your legs like hiking a football. Keep hips high.',
    'Explosive hip snap forward — ALL power from glutes and hips. Arms swing passively.',
    'Stand tall at the top: glutes squeezed, hips fully extended, arms at shoulder height.',
    'Let KB fall back. Re-hinge immediately. Rhythm: hinge → snap → swing.',
  ],
  commonErrors: [
    { error: 'Squatting instead of hinging', cameraDetection: 'Knee angle increases > 25° from calibration baseline' },
    { error: 'Using arms to lift', cameraDetection: 'Wrist rises above shoulder level at top' },
    { error: 'Not achieving full hip extension at top', cameraDetection: 'Hip hinge angle > 15° at top' },
    { error: 'Rounding back during hike', cameraDetection: 'Torso angle exceeds threshold during hinge' },
  ],
  breathing: 'Exhale sharply at hip snap (top). Inhale during hike back.',
  modifications: {
    easier: ['Romanian Deadlift (build hinge pattern)', 'Bodyweight hip hinge drill', 'Lighter KB'],
    harder: ['American KB swing (overhead)', 'One-arm KB swing', 'Double KB swing'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 15,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower back pain or hip issues',
    'I can perform a Romanian Deadlift with good form before attempting KB swings',
    'I understand that the power comes from my hips, not my arms',
  ],
  engineModule: 'kettlebell-swing',
  images: {
    hero: 'svg:kb-swing-hero',
    steps: ['svg:kb-swing-stance', 'svg:kb-swing-hike', 'svg:kb-swing-snap', 'svg:kb-swing-top'],
  },
  videoUrl: '',
};
