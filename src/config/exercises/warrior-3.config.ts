import type { ExerciseConfig } from './types';

export const warriorThreeConfig: ExerciseConfig = {
  id: 'warrior-3',
  catalogCode: 'G4',
  name: 'Warrior III',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Glutes', 'Hamstrings', 'Standing-leg quad', 'Core'],
  secondaryMuscles: ['Erector spinae', 'Shoulders', 'Ankle stabilizers'],
  difficulty: 'Advanced',
  trackFields: ['Hold duration', 'Torso level', 'Back-leg height', 'Form score'],
  instructions: [
    'Stand with your SIDE to the camera so your whole body is visible from the side.',
    'Shift your weight onto one leg and soften that knee slightly to start.',
    'Hinge your torso forward and extend the other leg straight back behind you.',
    'Bring your torso and back leg toward LEVEL — like an airplane "T", parallel to the floor.',
    'Straighten the standing leg and keep it strong and vertical. Reach your arms forward.',
    'Hold, gaze down, and breathe steadily — keep the torso and back leg lifted and level.',
  ],
  commonErrors: [
    { error: 'Torso too upright (not hinged into the T)', cameraDetection: 'Torso pitch > 50° from horizontal fires torso-not-level' },
    { error: 'Back leg dropping toward the floor', cameraDetection: 'Back-leg angle > 50° from horizontal fires back-leg-low' },
    { error: 'Standing knee bending', cameraDetection: 'Standing-knee flex > 30° fires leg-not-straight' },
    { error: 'Putting the lifted foot back down', cameraDetection: 'Lifted ankle + knee return toward the floor (recoverable)' },
    { error: 'Standing fully back up', cameraDetection: 'Shoulder Y rises > 15% above the T baseline → hold ends' },
  ],
  breathing: 'Inhale to lengthen from fingertips to back heel. Exhale to steady the balance. Slow, even breaths.',
  modifications: {
    easier: ['Hands on a wall or chair in front for support', 'Lift the back leg only partway', 'Hold the torso higher (a gentler hinge)'],
    harder: ['Hold longer (30 s+ per side)', 'Arms reaching forward by the ears', 'Bring torso + back leg fully parallel to the floor'],
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
  defaultHoldDurationSec: 15,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I have no acute knee, hip, ankle, or lower-back injury',
    'I can balance on one leg safely (or have a wall/chair nearby)',
    'I have space to extend a leg straight back without hitting anything',
  ],

  engineModule: 'warrior-3',

  images: {
    hero: 'svg:warrior-3-hero',
    steps: ['svg:warrior-3-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/ICGCs5COHvs',
};
