import type { ExerciseConfig } from './types';

export const donkeyKickConfig: ExerciseConfig = {
  id: 'donkey-kick',
  catalogCode: 'C-DK',
  name: 'Donkey Kick',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Gluteus Maximus'],
  secondaryMuscles: ['Hamstrings', 'Core', 'Lower Back'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps'],
  instructions: [
    'Start on all fours — hands directly below shoulders, knees below hips. Back flat, neutral spine.',
    'Brace your core. Keep your hips level throughout — do NOT let them rotate or tilt to the side.',
    'Lift your right knee off the floor, keeping it bent at 90°. This is your starting position.',
    'Drive your right heel toward the ceiling while squeezing your right glute hard.',
    'Stop when your thigh is roughly parallel to the floor — do not hyperextend your lower back.',
    'Lower with control back to the starting position. Complete all reps on one side, then switch.',
  ],
  commonErrors: [
    { error: 'Hips rotating or tilting to one side', cameraDetection: 'Left/right hip Y asymmetry during kick' },
    { error: 'Incomplete kick (thigh not reaching parallel)', cameraDetection: 'Peak thighLiftDeg < 45°' },
    { error: 'Lower back hyperextending instead of hip extending', cameraDetection: 'Hip Y rising significantly above calibrated position' },
    { error: 'Rushing the movement (ballistic kick)', cameraDetection: 'Rep duration < 500ms' },
  ],
  breathing: 'Exhale as you kick the heel up → inhale as you lower back to start.',
  modifications: {
    easier: ['Reduce range of motion — stop at 45° thigh lift', 'Slow tempo (3s up, 3s down)', 'Start with no resistance'],
    harder: ['Add resistance band above the knee', 'Pause 2 seconds at the top', 'Add ankle weights'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 12,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower-back or hip pain',
    'I have no wrist pain preventing weight-bearing on my hands',
    'I have no recent knee injury that prevents kneeling',
  ],
  engineModule: 'donkey-kick',
  images: {
    hero: 'svg:donkey-kick-hero',
    steps: ['svg:donkey-kick-start', 'svg:donkey-kick-top'],
  },
  videoUrl: undefined,
};
