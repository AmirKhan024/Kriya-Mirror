import type { ExerciseConfig } from './types';

export const cobraPoseConfig: ExerciseConfig = {
  id: 'cobra-pose',
  catalogCode: 'G19',
  name: 'Cobra Pose',
  category: 'yoga-standing',
  equipment: ['None', 'Mat (optional)'],
  primaryMuscles: ['Erector spinae', 'Glutes'],
  secondaryMuscles: ['Triceps', 'Posterior deltoid', 'Chest (stretch)'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Chest lift', 'Form score'],
  instructions: [
    'Lie face-down on the floor, side-on to the camera, legs extended behind you.',
    'Place your hands flat under your shoulders, elbows tucked close to your ribs.',
    'Press the tops of your feet and your hips down into the floor.',
    'Inhale and lift your chest, leading with the breastbone — keep your hips on the floor.',
    'Draw your shoulders down and back, away from your ears. Gaze slightly forward.',
    'Hold and breathe. To finish, lower your chest back down with control.',
  ],
  commonErrors: [
    { error: 'Not lifting the chest high enough', cameraDetection: 'Torso elevation angle stays below the hold threshold' },
    { error: 'Cranking the lower back instead of lengthening', cameraDetection: 'Shallow torso elevation (chest barely rises)' },
    { error: 'Shrugging the shoulders up to the ears', cameraDetection: 'Side-profile shoulder/neck line (coaching cue)' },
    { error: 'Collapsing the chest back to the floor', cameraDetection: 'Torso elevation returns toward 0° — hold ends' },
  ],
  breathing: 'Inhale to lift the chest; breathe smoothly through the hold. Never force the lift.',
  modifications: {
    easier: ['Sphinx pose — rest on the forearms instead of the hands', 'Lift only a few inches', 'Keep the elbows bent and low'],
    harder: ['Straighten the arms more for a deeper lift', 'Hold longer', 'Lift the hands briefly to engage the back, not the arms'],
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
    'I have no acute lower-back pain or disc injury aggravated by back-bending',
    'I have no wrist injury that prevents bearing weight on my hands',
    'I am not pregnant (prone back-bends are not advised during pregnancy)',
  ],

  engineModule: 'cobra-pose',

  images: {
    hero: 'svg:cobra-pose-hero',
    steps: ['svg:cobra-pose-hero', 'svg:cobra-pose-flat'],
  },
  videoUrl: 'https://youtube.com/shorts/F6V_3LUYp5U',
};
