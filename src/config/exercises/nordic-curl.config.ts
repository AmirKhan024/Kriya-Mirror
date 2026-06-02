import type { ExerciseConfig } from './types';

export const nordicCurlConfig: ExerciseConfig = {
  id: 'nordic-curl',
  catalogCode: 'N-NRC',
  name: 'Nordic Curl',
  category: 'bodyweight',
  equipment: [],
  primaryMuscles: ['Hamstrings'],
  secondaryMuscles: ['Glutes', 'Core'],
  difficulty: 'Advanced',
  trackFields: ['Reps', 'Depth'],
  instructions: [
    'Kneel on the floor with feet anchored under something heavy (or have a partner hold them).',
    'Cross arms over chest or extend in front.',
    'Keep your hips fully extended — the movement comes from the knee, not the hip.',
    'Slowly lower your torso forward as far as you can control.',
    'Use your hamstrings to curl back up.',
  ],
  commonErrors: [
    { error: 'Breaking at the hips (hinging at hip instead of at the knee)', cameraDetection: 'Hip angle opens > 30° from start position during descent' },
    { error: 'Not lowering far enough for a full eccentric stimulus', cameraDetection: 'Trunk lean < 40° from vertical at bottom' },
    { error: 'Dropping down too fast using gravity instead of controlled eccentric', cameraDetection: 'Rep duration < 300 ms' },
  ],
  breathing: 'Inhale on the way down — exhale as you curl back up.',
  modifications: {
    easier: ['Assisted Nordic curl (band or hands catch the fall)', 'Hip flexion allowed'],
    harder: ['Full range Nordic curl with no arm assist', 'Weighted Nordic'],
  },
  guidanceModes: { imageText: true, videoAudio: false, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 5,
  defaultRestSec: 120,
  safetyChecks: [
    'High-intensity exercise — Nordic curls are often associated with hamstring cramps.',
    'Do not attempt without adequate hamstring strength. Build with Romanian Deadlifts first.',
    'Stop immediately if you feel sharp pain.',
  ],
  engineModule: 'nordic-curl',
  images: { hero: 'svg:nordic-curl-hero', steps: [] },
  videoUrl: undefined,
};
