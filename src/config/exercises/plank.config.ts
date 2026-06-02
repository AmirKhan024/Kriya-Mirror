import type { ExerciseConfig } from './types';

export const plankConfig: ExerciseConfig = {
  id: 'plank',
  catalogCode: 'C — Plank',
  name: 'Plank',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Core (rectus abdominis, transverse abdominis)'],
  secondaryMuscles: ['Shoulders', 'Glutes', 'Back'],
  difficulty: 'Beginner',
  trackFields: ['Duration', 'Form score', 'Alignment'],
  instructions: [
    'Lie face-down. Place forearms on the floor, elbows directly under shoulders.',
    'Push up onto forearms and toes. Body forms a straight line head to heels.',
    'Brace your core — pull your navel toward your spine.',
    'Squeeze your glutes to keep hips level. Avoid sagging or piking.',
    'Hold the position. Breathe normally — do not hold your breath.',
    'Gaze at a spot on the floor 6 inches in front of your hands — neutral neck.',
  ],
  commonErrors: [
    { error: 'Hips sagging toward the floor', cameraDetection: 'Hip landmark drops below shoulder-ankle line' },
    { error: 'Hips piking (butt in the air)', cameraDetection: 'Hip landmark rises above shoulder-ankle line' },
    { error: 'Spine curving (not straight line)', cameraDetection: 'Shoulder→hip→ankle angle deviates from 180°' },
    { error: 'Neck hyperextension or droop', cameraDetection: 'Nose landmark hangs below shoulder line' },
  ],
  breathing: 'Breathe normally throughout. Do not hold your breath.',
  modifications: {
    easier: ['Knee plank (drop knees to floor)', 'Wall plank (standing, hands on wall)'],
    harder: ['Long-lever plank (hands further forward)', 'Single-arm plank', 'Plank with leg lifts'],
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
    'I have no acute lower-back pain or recent spinal injury',
    'I have no shoulder injury preventing weight-bearing on forearms',
    'I have no wrist injury (only relevant if doing high plank)',
  ],

  engineModule: 'plank',

  images: {
    hero: 'svg:plank-hero',
    steps: ['svg:plank-hero', 'svg:plank-sag', 'svg:plank-pike'],
  },
  videoUrl: 'https://youtube.com/shorts/v25dawSzRTM',
};
