import type { ExerciseConfig } from './types';

export const boxJumpConfig: ExerciseConfig = {
  id: 'box-jump',
  catalogCode: 'D12',
  name: 'Box Jump',
  category: 'functional',
  equipment: ['Box or Step'],
  primaryMuscles: ['Quadriceps', 'Glutes', 'Calves'],
  secondaryMuscles: ['Hamstrings', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Jump height (estimated)', 'Landing quality'],
  instructions: [
    'Stand side-on to the camera, feet shoulder-width, facing the box.',
    'Load: dip into a quick quarter-squat. Arms swing back.',
    'Jump explosively. Drive arms forward and up for momentum.',
    'Land softly on the box — toes first, then heels. Bend knees to 90° on landing.',
    'Stand fully upright on the box, then STEP BACK DOWN to the floor. Each floor-return = 1 rep.',
  ],
  commonErrors: [
    { error: 'Stiff-legged landing', cameraDetection: 'Knee angle stays > 150° for 300ms after landing' },
    { error: 'No loading dip before jump', cameraDetection: 'AIRBORNE detected without prior LOADING state' },
    { error: 'Insufficient jump height', cameraDetection: 'Hip Y displacement < minimum threshold' },
  ],
  breathing: 'Exhale on the jump. Inhale on landing.',
  modifications: {
    easier: ['Box step-up', 'Squat jump (no box)', 'Low box (20cm)'],
    harder: ['Higher box', 'Depth jump (drop + immediate rebound)', 'Weighted box jump'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 4,
  defaultRepsPerSet: 5,
  defaultRestSec: 90,
  safetyChecks: [
    'I have no knee or ankle injuries',
    'I can squat with good form before attempting box jumps',
    'My landing surface is stable and non-slip',
  ],
  engineModule: 'box-jump',
  images: { hero: 'svg:box-jump-hero', steps: ['svg:box-jump-load', 'svg:box-jump-air', 'svg:box-jump-land'] },
  videoUrl: '',
};
