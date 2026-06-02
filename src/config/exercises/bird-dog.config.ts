import type { ExerciseConfig } from './types';

export const birdDogConfig: ExerciseConfig = {
  id: 'bird-dog',
  catalogCode: 'C-BD',
  name: 'Bird-Dog',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Core', 'Glutes'],
  secondaryMuscles: ['Lower Back', 'Hamstrings', 'Shoulders'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps'],
  instructions: [
    'Start on all fours — hands directly below shoulders, knees below hips. Back flat, neutral spine.',
    'Brace your core. Keep your hips level throughout — do not let them rotate or tilt.',
    'Simultaneously extend your right arm forward and left leg backward until both are horizontal.',
    'Hold for 1–2 seconds at the top. Your arm, torso, and extended leg should form one straight line.',
    'Lower with control and return to the start position.',
    'Alternate sides: left arm + right leg next. Each full extension = one rep per side.',
  ],
  commonErrors: [
    { error: 'Hips rotating as leg extends', cameraDetection: 'Left/right hip Y asymmetry during extension' },
    { error: 'Lower back arching instead of extending the leg', cameraDetection: 'Hip Y rising above calibrated baseline' },
    { error: 'Incomplete extension (arm/leg not reaching horizontal)', cameraDetection: 'Peak hipKneeAnkleDeg < 135° (extensionDeg < 45°)' },
    { error: 'Rushing the movement (ballistic extension)', cameraDetection: 'Rep duration < 600ms' },
  ],
  breathing: 'Exhale as you extend → inhale as you return to the start.',
  modifications: {
    easier: ['Extend arm only (no leg)', 'Extend leg only (no arm)', 'Reduce hold time'],
    harder: ['Add resistance band on ankle', 'Touch elbow to opposite knee at bottom', 'Add pause at full extension'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower-back or hip pain',
    'I have no wrist pain that makes weight-bearing on hands uncomfortable',
    'I have no recent knee injury preventing kneeling',
  ],

  engineModule: 'bird-dog',

  images: {
    hero: 'svg:bird-dog-hero',
    steps: ['svg:bird-dog-start', 'svg:bird-dog-extend'],
  },
  videoUrl: undefined,
};
