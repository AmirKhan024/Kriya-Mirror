import type { ExerciseConfig } from './types';

export const singleLegStandConfig: ExerciseConfig = {
  id: 'single-leg-stand',
  catalogCode: 'K1',
  name: 'Single Leg Stand',
  category: 'balance',
  equipment: ['None'],
  primaryMuscles: ['Ankle stabilizers', 'Hip stabilizers (Glute medius)', 'Core'],
  secondaryMuscles: ['Calves', 'Quadriceps (standing leg)', 'Foot intrinsics'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Sway score', 'Hip levelness'],
  instructions: [
    'Stand tall, facing the camera. Hands relaxed at your sides.',
    'Lift one foot a few inches off the floor — bend that knee so the foot floats. The other leg stays straight.',
    'Pick a point on the wall ahead and focus your gaze there.',
    'Stand as still as possible. Small sway is normal; avoid grabbing for balance.',
    'Keep your hips LEVEL — don’t let the lifted-side hip drop down.',
    'Breathe normally through your nose. If you lose balance, reset and continue.',
  ],
  commonErrors: [
    { error: 'Excessive body sway (instability)', cameraDetection: 'CoM-proxy displacement > 6° from baseline for 6+ frames' },
    { error: 'Lifted-side hip drops (Trendelenburg sign)', cameraDetection: 'Lifted-side hip Y drops > 15% of shoulder width below standing-side hip' },
    { error: 'Foot returns to the floor (hold broken)', cameraDetection: 'Lifted ankle Y returns to within 10% of shoulder width of the standing ankle' },
    { error: 'Standing leg knee buckling', cameraDetection: 'Knee flex angle increases significantly during hold' },
    { error: 'Reaching arms out for balance (flailing)', cameraDetection: 'Wrist Y rises above shoulder Y' },
  ],
  breathing: 'Breathe slowly and normally. Holding your breath tightens your nervous system and makes balance harder.',
  modifications: {
    easier: ['Hold lightly onto a wall or chair', 'Lift the foot only slightly (just toe off the floor)', 'Tandem Stand (feet inline but both on the floor)'],
    harder: ['Single Leg Stand with eyes closed (K2)', 'Tree Pose — foot on inner calf (K4)', 'Warrior III — torso parallel to floor (K5)'],
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
    'I have no acute vertigo or vestibular dysfunction',
    'I have no untreated balance disorder that puts me at fall risk',
    'I am near a wall or chair I can grab if I lose balance',
  ],

  engineModule: 'single-leg-stand',

  images: {
    hero: 'svg:single-leg-stand-hero',
    steps: ['svg:single-leg-stand-standing', 'svg:single-leg-stand-tilted', 'svg:single-leg-stand-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/2AyaGPkiOuo',
};
