import type { ExerciseConfig } from './types';

export const standingFigure4Config: ExerciseConfig = {
  id: 'standing-figure-4',
  catalogCode: 'J24S',
  name: 'Standing Figure-4',
  category: 'mobility',
  equipment: ['None'],
  primaryMuscles: ['Glutes (crossed leg)', 'Hip external rotators (Piriformis)', 'Hip stabilizers'],
  secondaryMuscles: ['Quadriceps (standing leg)', 'Core', 'Ankle stabilizers'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Sway score', 'Longest steady hold'],
  instructions: [
    'Stand tall, facing the camera, with your whole body in frame. Hands together at your chest.',
    'Shift your weight onto one leg. Cross the other ankle over the opposite knee, so your legs make a figure-4 shape.',
    'Flex the crossed foot to protect the knee. Let the crossed knee open out to the side.',
    'Sit your hips back and down into a mini-squat — as deep as is comfortable. Keep your chest tall.',
    'Pick a point on the wall ahead and hold your gaze steady. Stand as still as possible.',
    'Breathe normally. If the crossed foot slips off, reset it and continue. Switch sides on your next set.',
  ],
  commonErrors: [
    { error: 'Crossed foot drifts off the standing knee', cameraDetection: 'Crossed ankle X drifts > 0.06 from the standing-knee X for 6+ frames → foot-off-leg (recoverable)' },
    { error: 'Excessive body sway (instability)', cameraDetection: 'CoM-proxy displacement > 12° from baseline for 6+ frames freezes the timer' },
    { error: 'Crossed-side hip drops (uneven pelvis)', cameraDetection: 'Crossed-side hip Y drops > 15% of shoulder width below the standing hip' },
    { error: 'Crossed leg lowered back to the floor', cameraDetection: 'Crossed ankle AND knee both return toward the standing leg → foot-dropped (recoverable)' },
    { error: 'User stands fully back up', cameraDetection: 'Shoulder Y rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Breathe slowly and evenly. Steady breath = steady balance and a deeper hip release.',
  modifications: {
    easier: ['Shallower mini-squat', 'Hold lightly onto a wall or chair with one hand', 'Rest the crossed ankle lower on the shin'],
    harder: ['Sit deeper into the mini-squat', 'Hold longer (45–60 s per side)', 'Fold the chest slightly forward over the figure-4'],
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
    'I have no acute knee, hip, or ankle injury on either leg',
    'I have no acute vertigo or balance disorder that puts me at fall risk',
    'I am near a wall or chair I can grab if I lose balance',
  ],

  engineModule: 'standing-figure-4',

  images: {
    hero: 'svg:tree-pose-hero',
    steps: ['svg:tree-pose-hero', 'svg:tree-pose-foot-off'],
  },
  videoUrl: 'https://youtu.be/nMnr3DVWgo8',
};
