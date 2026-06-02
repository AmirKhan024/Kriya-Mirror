import type { ExerciseConfig } from './types';

export const warriorOneConfig: ExerciseConfig = {
  id: 'warrior-1',
  catalogCode: 'G2',
  name: 'Warrior I',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps (front leg)', 'Glutes', 'Hip flexors (back leg)'],
  secondaryMuscles: ['Calves', 'Shoulders', 'Core', 'Back'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Front knee depth', 'Arms overhead', 'Form score'],
  instructions: [
    'Stand with your SIDE to the camera so your whole lunge is visible from the side.',
    'Step one foot forward into a lunge. Bend the front knee toward ~90°, stacking it over the ankle.',
    'Keep the back leg straight and strong, back heel grounded or lifted — whatever lets you stay tall.',
    'Square your hips and chest toward the front foot. Lift the torso UPRIGHT — do not fold forward.',
    'Reach BOTH arms straight up overhead, biceps by your ears, fingertips toward the ceiling.',
    'Hold and breathe steadily, keeping the arms lifted the whole time.',
  ],
  commonErrors: [
    { error: 'Front knee not bent enough (standing too tall)', cameraDetection: 'Front knee flex < 50° fires front-knee-not-bent-enough' },
    { error: 'Front knee bent past 90°/toes (sinking too deep)', cameraDetection: 'Front knee flex > 120° fires front-knee-bent-too-much' },
    { error: 'Back leg bending (should stay straight)', cameraDetection: 'Back knee flex > 25° fires back-knee-bent' },
    { error: 'Torso leaning forward over the front leg', cameraDetection: 'Trunk lean > 25° from vertical fires torso-too-forward' },
    { error: 'Arms dropping from overhead', cameraDetection: 'Either wrist falls below shoulder line for 6+ frames fires arms-not-overhead' },
    { error: 'User stands fully back up', cameraDetection: 'Shoulder Y rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Inhale to lengthen the spine and reach the arms higher. Exhale to root down through the legs. Steady deep breaths.',
  modifications: {
    easier: ['Shorter stance', 'Front knee less bent until you build strength', 'Hands at heart/prayer if shoulders fatigue'],
    harder: ['Hold longer (45–60 s per side)', 'Deepen the front-knee bend toward 90°', 'Lift the back heel for a high lunge'],
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
    'I can raise both arms overhead without shoulder pain',
  ],

  engineModule: 'warrior-1',

  images: {
    hero: 'svg:warrior-1-hero',
    steps: ['svg:warrior-1-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/56hnUF1scTE',
};
