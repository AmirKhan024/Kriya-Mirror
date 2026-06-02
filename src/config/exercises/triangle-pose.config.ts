import type { ExerciseConfig } from './types';

export const trianglePoseConfig: ExerciseConfig = {
  id: 'triangle-pose',
  catalogCode: 'G6 — Trikonasana',
  name: 'Triangle Pose',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Hamstrings', 'Hips', 'Obliques'],
  secondaryMuscles: ['Quadriceps', 'Shoulders', 'Calves', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Top-arm angle', 'Bottom-arm reach', 'Form score'],
  instructions: [
    'Stand FACING the camera with your feet wide apart (about leg-length).',
    'Turn the FRONT foot 90° out to one side; turn the back foot ~30–45° inward.',
    'Keep BOTH legs completely straight — do not bend either knee.',
    'Hinge SIDEWAYS at the hip toward the front foot — reach the SAME-SIDE hand DOWN toward the front shin (or floor/block).',
    'Extend the OPPOSITE arm STRAIGHT UP toward the ceiling — directly above the top shoulder.',
    'Open your chest toward the camera. Keep the top arm long.',
    'Hold the pose. Breathe steadily — do not collapse the torso forward.',
  ],
  commonErrors: [
    { error: 'Front or back knee bending (legs should stay straight)', cameraDetection: 'Either knee flex > 25° fires leg-not-straight' },
    { error: 'Top arm tilting forward or back from vertical', cameraDetection: 'Top-arm angle > 20° from vertical fires top-arm-not-vertical' },
    { error: 'Bottom hand lifted away from the front foot', cameraDetection: 'Bottom-wrist Y > 15% body-height above front-ankle Y fires bottom-arm-not-down' },
    { error: 'Standing fully back up (ending the hold)', cameraDetection: 'Shoulder Y rises > 15% body height above baseline → hold ends' },
  ],
  breathing: 'Inhale to lengthen the spine. Exhale to deepen the hinge. Long, steady breaths.',
  modifications: {
    easier: ['Bottom hand on the shin or a block instead of the floor', 'Slightly narrower stance', 'Look forward instead of up at the top hand'],
    harder: ['Bottom hand to the floor outside the front foot', 'Hold each side for 45–60 s', 'Gaze up at the top thumb the entire hold'],
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
    'I have no acute hamstring, hip, or lower-back injury',
    'I have no shoulder injury that prevents raising one arm overhead',
    'I can balance comfortably in a wide stance',
  ],

  engineModule: 'triangle-pose',

  images: {
    hero: 'svg:triangle-pose-hero',
    steps: ['svg:triangle-pose-hero', 'svg:triangle-pose-knee-bent', 'svg:triangle-pose-arm-not-down'],
  },
  videoUrl: 'https://youtube.com/shorts/thybVfw4ZBs?si=yPHXAEoMEkkgSw_5',
};
