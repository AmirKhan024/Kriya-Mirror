import type { ExerciseConfig } from './types';

export const inchwormConfig: ExerciseConfig = {
  id: 'inchworm',
  catalogCode: 'C25',
  name: 'Inchworm',
  category: 'bodyweight',
  equipment: ['None (floor)'],
  primaryMuscles: ['Hamstrings', 'Core', 'Shoulders'],
  secondaryMuscles: ['Hip Flexors', 'Glutes', 'Erector Spinae'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps'],
  instructions: [
    'Stand tall with feet hip-width apart, arms relaxed at your sides.',
    'Hinge forward at the hips, bending until your hands reach the floor near your feet. Keep your legs as straight as possible.',
    'Walk your hands forward until your body forms a straight plank position.',
    'Walk your hands back toward your feet.',
    'Stand back up by hinging at the hips. That is one rep.',
    'For this session, each forward fold and return counts as one rep.',
  ],
  commonErrors: [
    { error: 'Bending knees excessively — keep legs straight throughout', cameraDetection: 'Knee angle deviation tracked from side view' },
    { error: 'Not hinging deep enough — hands should reach the floor', cameraDetection: 'Hip hinge angle must exceed 45° to count as a valid rep' },
    { error: 'Rushing the movement — use controlled pace', cameraDetection: 'Rep under 600 ms flagged as malformed' },
  ],
  breathing: 'Exhale as you fold forward → breathe naturally in plank → inhale as you stand back up.',
  modifications: {
    easier: ['Keep knees slightly bent if hamstrings are tight', 'Shorten the walk-out distance'],
    harder: ['Add a push-up at the plank position', 'Slow the pace to 4 counts down, hold, 4 counts back'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 8,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower back pain or disc injury',
    'I have no hamstring injury that restricts forward bending',
    'I have no wrist or shoulder issue that prevents weight-bearing on my hands',
  ],

  engineModule: 'inchworm',

  images: {
    hero: 'svg:inchworm-hero',
    steps: ['svg:inchworm-stand', 'svg:inchworm-fold', 'svg:inchworm-plank'],
  },
  videoUrl: undefined,
};
