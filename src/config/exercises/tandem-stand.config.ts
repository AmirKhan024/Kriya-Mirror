import type { ExerciseConfig } from './types';

export const tandemStandConfig: ExerciseConfig = {
  id: 'tandem-stand',
  catalogCode: 'K6 / BB5',
  name: 'Tandem Stand',
  category: 'balance',
  equipment: ['None'],
  primaryMuscles: ['Ankle stabilizers', 'Core', 'Hip stabilizers'],
  secondaryMuscles: ['Calves', 'Glute medius'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Sway angle', 'Form score'],
  instructions: [
    'Stand tall, facing the camera. Place hands on your hips.',
    'Place one foot directly in front of the other — heel of the front foot touching (or nearly touching) the toes of the back foot, in a straight line.',
    'Pick a point on the wall ahead and focus your gaze there.',
    'Hold as still as possible. Small sway is normal; avoid stepping out of the line.',
    'Breathe normally. Don’t hold your breath — that makes balance harder, not easier.',
    'If you lose balance, reset your feet heel-to-toe and continue.',
  ],
  commonErrors: [
    { error: 'Excessive body sway (instability)', cameraDetection: 'Center-of-mass-proxy displacement > 6° from baseline for 6+ frames' },
    { error: 'Feet drifting out of tandem line', cameraDetection: 'Ankle x-distance > 45% of shoulder width' },
    { error: 'Stepping out (hold broken)', cameraDetection: 'Ankle x-distance > 70% of shoulder width OR shoulder rose > 15% (user stood)' },
    { error: 'Trunk leaning forward / back to compensate', cameraDetection: 'Trunk lean angle > 8° from vertical' },
    { error: 'Hands coming off hips (flailing for balance)', cameraDetection: 'Wrist Y drifts more than 20% of trunk length from hip Y' },
  ],
  breathing: 'Breathe slowly and normally through your nose. Holding your breath tightens your nervous system and makes balance harder.',
  modifications: {
    easier: ['Twin Leg Stand (feet shoulder-width apart)', 'Hold a wall or chair lightly for support', 'Open your eyes and pick a closer focal point'],
    harder: ['Single Leg Stand', 'Tandem Stand with eyes closed', 'Tandem Stand on a foam pad'],
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
    'I have no acute vertigo or vestibular dysfunction',
    'I have no untreated balance disorder that puts me at fall risk',
    'I am near a wall or chair I can grab if I lose balance',
  ],

  engineModule: 'tandem-stand',

  images: {
    hero: 'svg:tandem-stand-hero',
    steps: ['svg:tandem-stand-stand', 'svg:tandem-stand-shifted', 'svg:tandem-stand-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/euXpZ1gBwOo',
};
