import type { ExerciseConfig } from './types';

export const stepUpConfig: ExerciseConfig = {
  id: 'step-up',
  catalogCode: 'C-SU',
  name: 'Step-Up',
  category: 'bodyweight',
  equipment: ['Chair or step'],
  primaryMuscles: ['Quadriceps', 'Glutes'],
  secondaryMuscles: ['Hamstrings', 'Calves', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (each leg)'],
  instructions: [
    'Stand about 30 cm in front of a sturdy chair, bench, or step. Feet hip-width apart.',
    'Place your right foot flat on the step. Your knee should be at or below hip height.',
    'Press through your right heel and drive your body upward until your right leg is fully straight.',
    'Bring your left foot up to meet the right on the step — stand tall at the top.',
    'Step back down with your right foot first, then your left. Return to the start.',
    'Alternate the leading leg each set, or do all reps on one side then switch.',
  ],
  commonErrors: [
    { error: 'Lead knee caving inward (valgus)', cameraDetection: 'Lead knee X collapsing toward midline > 20% vs baseline' },
    { error: 'Excessive forward trunk lean', cameraDetection: 'Trunk angle > 40°' },
    { error: 'Pushing off the rear leg (not driving through lead leg)', cameraDetection: 'Hip rise < MIN_HIP_RISE (0.10) at rep close' },
    { error: 'Step height too low (barely rising)', cameraDetection: 'Peak hipRise < AT_TOP_THRESHOLD (0.12)' },
  ],
  breathing: 'Exhale as you step up and drive → inhale as you step back down.',
  modifications: {
    easier: ['Lower step height (2–3 books)', 'Hold a wall or door frame for balance', 'Slow tempo (3s up, 3s down)'],
    harder: ['Add dumbbells', 'Raise knee at top (knee drive)', 'Higher step'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute knee pain (especially with weight-bearing activities)',
    'I have a stable chair, bench, or step that will not slide',
    'I have no balance issues that make single-leg loading unsafe',
  ],

  engineModule: 'step-up',

  images: {
    hero: 'svg:step-up-hero',
    steps: ['svg:step-up-start', 'svg:step-up-mid', 'svg:step-up-top'],
  },
  videoUrl: undefined,
};
