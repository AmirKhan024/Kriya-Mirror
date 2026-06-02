import type { ExerciseConfig } from './types';

export const sidePlankConfig: ExerciseConfig = {
  id: 'side-plank',
  catalogCode: 'C — Side Plank',
  name: 'Side Plank',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Obliques', 'Quadratus lumborum', 'Glute medius'],
  secondaryMuscles: ['Shoulder stabilizers', 'Deep core', 'Adductors'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Hip alignment', 'Form score'],
  instructions: [
    'Place the camera in front of you so your CHEST faces it during the hold.',
    'Lie on one side, then prop up on that forearm — elbow directly under the shoulder.',
    'Stack your feet (or stagger them) and lift your hips so your body makes ONE straight line.',
    'Keep your body in a long line across the screen — do not let the hips sag toward the floor.',
    'Reach the top arm up toward the ceiling. Gaze forward and breathe steadily.',
    'Hold; keep the line straight the whole time. Switch sides on the next set.',
  ],
  commonErrors: [
    { error: 'Hips sagging toward the floor', cameraDetection: 'Hip drops below the shoulder–ankle line > 0.04 fires hip-sag' },
    { error: 'Hips piking up too high', cameraDetection: 'Hip rises above the line > 0.04 fires hip-pike' },
    { error: 'Body bending / breaking the straight line', cameraDetection: 'Shoulder–hip–ankle bend > 12° fires spine-misaligned' },
    { error: 'Coming out of the plank (sitting/standing up)', cameraDetection: 'Shoulder Y rises > 18% above baseline → hold ends' },
  ],
  breathing: 'Breathe steadily into the side ribs. Exhale to brace the obliques and keep the hips lifted.',
  modifications: {
    easier: ['Drop the bottom knee to the floor (kneeling side plank)', 'Shorter holds', 'Top hand on the hip instead of reaching up'],
    harder: ['Hold longer (45 s+ per side)', 'Lift the top leg (star side plank)', 'Straight-arm side plank (hand instead of forearm)'],
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
  defaultHoldDurationSec: 20,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I have no acute shoulder, wrist, or elbow injury on the supporting arm',
    'I have no recent rib, hip, or lower-back injury',
    'I can support my body weight on one forearm safely',
  ],

  engineModule: 'side-plank',

  images: {
    hero: 'svg:side-plank-hero',
    steps: ['svg:side-plank-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/fzLeV8X0Gb8',
};
