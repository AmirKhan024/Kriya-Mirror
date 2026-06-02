import type { ExerciseConfig } from './types';

export const gatePoseConfig: ExerciseConfig = {
  id: 'gate-pose',
  catalogCode: 'G-Parighasana',
  name: 'Gate Pose',
  category: 'mobility',
  equipment: ['None'],
  primaryMuscles: ['Obliques', 'Intercostals', 'Lateral hip (extended leg)'],
  secondaryMuscles: ['Shoulders', 'Quadratus lumborum', 'Adductors'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Side-bend depth', 'Top-arm reach', 'Form score'],
  instructions: [
    'Kneel on one knee, facing the camera, with your whole body in frame.',
    'Extend the OTHER leg straight out to the side, foot flat, so your stance is wide.',
    'Rest the hand on that side lightly on the extended leg.',
    'Reach the opposite arm up and arc it overhead and OVER toward the extended leg — making a long curve down your side.',
    'Hold the side bend. Keep reaching up and over; breathe into the stretched side ribs.',
    'Come up slowly and switch sides on your next set.',
  ],
  commonErrors: [
    { error: 'Not bending far enough (staying upright)', cameraDetection: 'Lateral lean drops below ~14° for 6+ frames → incomplete-bend (recoverable, freezes the timer)' },
    { error: 'Top arm dropping out of the reach', cameraDetection: 'The raised wrist falls toward shoulder height → arms-not-overhead (recoverable, freezes the timer)' },
    { error: 'User comes all the way up', cameraDetection: 'Shoulder line rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Inhale to lengthen and reach the arm higher; exhale to bend deeper into the side. Slow, even breaths.',
  modifications: {
    easier: ['Smaller side bend', 'Top hand to the hip instead of overhead', 'Sit on a folded blanket if the kneeling knee is sensitive'],
    harder: ['Deeper side bend, reaching the top arm further over', 'Hold longer (45–60 s per side)', 'Gaze up toward the top hand'],
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
    'I have no acute knee injury (the kneeling knee bears weight)',
    'I have no acute lower-back or rib injury',
    'I can kneel comfortably on a padded surface',
  ],

  engineModule: 'gate-pose',

  images: {
    hero: 'svg:triangle-pose-hero',
    steps: ['svg:triangle-pose-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/EgnAOxqOnJI',
};
