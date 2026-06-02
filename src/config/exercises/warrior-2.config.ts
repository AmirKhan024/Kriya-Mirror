import type { ExerciseConfig } from './types';

export const warriorTwoConfig: ExerciseConfig = {
  id: 'warrior-2',
  catalogCode: 'G3',
  name: 'Warrior II',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps (front leg)', 'Glutes', 'Hip stabilizers'],
  secondaryMuscles: ['Inner thigh', 'Calves', 'Shoulders', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Front knee depth', 'Form score'],
  instructions: [
    'Stand FACING the camera with feet wide apart (about leg-length distance).',
    'Step one foot out wide to the side. Turn that foot so it points outward; keep the other foot pointing forward.',
    'Bend the stepped-out knee to ~90°. Stack the bent knee directly over its ankle — do NOT push past the toes.',
    'Keep the other leg STRAIGHT. Press through the outer edge of that foot.',
    'Lift the torso UPRIGHT — do not lean forward over the bent leg.',
    'Extend both arms out to the sides at shoulder height, parallel to the floor.',
    'Hold and breathe steadily.',
  ],
  commonErrors: [
    { error: 'Front knee not bent enough (standing too tall)', cameraDetection: 'Front knee flex < 70° fires front-knee-not-bent-enough' },
    { error: 'Front knee bent past 90° / past the toes (going too deep)', cameraDetection: 'Front knee flex > 120° fires front-knee-bent-too-much' },
    { error: 'Back leg bending (should stay straight)', cameraDetection: 'Back knee flex > 25° fires back-knee-bent' },
    { error: 'Torso leaning forward over front leg', cameraDetection: 'Trunk lean > 25° from vertical fires torso-too-forward' },
    { error: 'User stands fully back up', cameraDetection: 'Shoulder Y rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Inhale to lengthen the spine. Exhale to sink slightly deeper. Steady deep breaths.',
  modifications: {
    easier: ['Shorter stance (less spread between feet)', 'Front knee less bent (~120°) until you build strength', 'Arms at chest in prayer position if shoulders fatigue'],
    harder: ['Hold longer (45-60 s per side)', 'Reverse Warrior variation', 'Extended Side Angle from Warrior II'],
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
  defaultHoldDurationSec: 25,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I have no acute knee, hip, or ankle injury',
    'I have no recent lower-back strain',
    'I can balance in a wide stance safely',
  ],

  engineModule: 'warrior-2',

  images: {
    hero: 'svg:warrior-2-hero',
    steps: ['svg:warrior-2-hero', 'svg:warrior-2-knee-up', 'svg:warrior-2-lean'],
  },
  videoUrl: 'https://youtube.com/shorts/vxvLxyahNOA',
};
