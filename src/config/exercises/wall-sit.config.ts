import type { ExerciseConfig } from './types';

export const wallSitConfig: ExerciseConfig = {
  id: 'wall-sit',
  catalogCode: 'C — Wall Sit',
  name: 'Wall Sit',
  category: 'bodyweight',
  equipment: ['Wall'],
  primaryMuscles: ['Quadriceps'],
  secondaryMuscles: ['Glutes', 'Hamstrings', 'Calves', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Duration', 'Form score', 'Knee angle'],
  instructions: [
    'Stand side-on to the camera with your back against a wall, feet hip-width apart.',
    'Walk your feet forward and slide your back down the wall.',
    'Lower until your thighs are parallel to the floor — knee angle around 90°.',
    'Keep your shins vertical: knees stacked directly over your ankles.',
    'Press your whole back flat against the wall. Keep your chest tall — do not lean forward.',
    'Keep your weight in your heels. Do not let the heels lift off the floor.',
    'Hold the position. Breathe steadily — do not hold your breath.',
  ],
  commonErrors: [
    { error: 'Hips rising / sliding up the wall (losing depth)', cameraDetection: 'Knee flexion angle drops below 60°' },
    { error: 'Leaning forward off the wall', cameraDetection: 'Shoulder-hip vector tilts > 25° from vertical' },
    { error: 'Heels lifting off the floor', cameraDetection: 'Ankle Y rises > 3% of body length above baseline' },
    { error: 'Standing fully back up (ending the hold)', cameraDetection: 'Shoulder Y rises > 12% of body length above baseline' },
  ],
  breathing: 'Breathe slowly and steadily throughout the hold. Do not hold your breath — that spikes blood pressure during an isometric.',
  modifications: {
    easier: ['Higher wall sit (knees bent less, ~120°)', 'Shorter hold time', 'Hands resting on thighs'],
    harder: ['Hold longer', 'Single-leg wall sit', 'Hold a weight plate on your lap'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'hold-based',
  isStrength: false,
  defaultSets: 0,
  defaultRepsPerSet: 0,
  defaultRestSec: 0,
  defaultHoldDurationSec: 30,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I have no acute knee pain or recent knee injury',
    'I have no lower-back injury that prevents holding a seated position',
    'I can stand and bend my knees without dizziness',
  ],

  engineModule: 'wall-sit',

  images: {
    hero: 'svg:wall-sit-hero',
    steps: ['svg:wall-sit-hero', 'svg:wall-sit-knees-straight', 'svg:wall-sit-forward-lean'],
  },
  videoUrl: 'https://youtube.com/shorts/mDdLC-yKudY?si=D9Xg4Xt2pLplReH8',
};
