import type { ExerciseConfig } from './types';

export const treePoseConfig: ExerciseConfig = {
  id: 'tree-pose',
  catalogCode: 'G9',
  name: 'Tree Pose',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Hip stabilizers (Glute medius)', 'Quadriceps (standing leg)', 'Core'],
  secondaryMuscles: ['Calves', 'Ankle stabilizers', 'Adductors (lifted leg)'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Sway score', 'Foot-on-leg consistency'],
  instructions: [
    'Stand tall, facing the camera. Hands together at your chest (prayer position) or extended overhead.',
    'Shift your weight onto one leg. Lift the other foot and place the sole against your inner calf or inner thigh — NEVER directly on the knee joint.',
    'Press the lifted foot INTO your standing leg and the standing leg back into the foot — find a "press" connection.',
    'Pick a point on the wall ahead and hold your gaze steady.',
    'Keep your hips level — don\'t let the lifted-side hip drop or jut out.',
    'Breathe normally through your nose. If your foot slips off the leg, reset it and continue.',
  ],
  commonErrors: [
    { error: 'Lifted foot drifts off the standing leg', cameraDetection: 'Lifted ankle X drifts > 0.06 from the standing-knee X for 6+ frames' },
    { error: 'Excessive body sway (instability)', cameraDetection: 'CoM-proxy displacement > 12° from baseline for 6+ frames' },
    { error: 'Lifted-side hip drops (Trendelenburg sign)', cameraDetection: 'Lifted-side hip Y drops > 15% of shoulder width below standing-side hip' },
    { error: 'Foot returns to the floor (hold broken)', cameraDetection: 'Lifted ankle Y returns to standing-ankle Y AND lifted knee straightens' },
    { error: 'User stands fully back up', cameraDetection: 'Shoulder Y rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Breathe slowly and normally. Steady breath = steady balance.',
  modifications: {
    easier: ['Lifted foot on inner calf (lower) instead of inner thigh', 'Hold lightly onto a wall or chair with one hand', 'Hands at chest instead of overhead'],
    harder: ['Eyes closed (vestibular challenge)', 'Arms extended overhead in steeple shape', 'Add a slow torso rotation while holding'],
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
    'I have no recent ankle, knee, or hip injury on either leg',
    'I am near a wall or chair I can grab if I lose balance',
  ],

  engineModule: 'tree-pose',

  images: {
    hero: 'svg:tree-pose-hero',
    steps: ['svg:tree-pose-hero', 'svg:tree-pose-foot-off'],
  },
  videoUrl: 'https://youtube.com/shorts/PZ1zAvcKzrg',
};
