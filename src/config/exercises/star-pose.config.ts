import type { ExerciseConfig } from './types';

export const starPoseConfig: ExerciseConfig = {
  id: 'star-pose',
  catalogCode: 'K13',
  name: 'Star Pose',
  category: 'balance',
  equipment: ['None'],
  primaryMuscles: ['Hip stabilizers (Glute medius)', 'Ankle stabilizers', 'Core'],
  secondaryMuscles: ['Quadriceps (standing leg)', 'Shoulders', 'Obliques'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Sway score', 'Longest steady hold'],
  instructions: [
    'Stand tall, facing the camera, with your whole body in frame.',
    'Shift your weight onto one leg. Keep that standing leg strong and stable.',
    'Extend the OTHER leg straight out to the side and lift the foot off the floor — make your legs wide, like the bottom of a star.',
    'Raise BOTH arms up and out so your body forms a star shape.',
    'Pick a point on the wall ahead and fix your gaze there. Stand as still as possible.',
    'Breathe normally. If you wobble, reset into the star and continue. Switch sides on your next set.',
  ],
  commonErrors: [
    { error: 'Excessive body sway (instability)', cameraDetection: 'CoM-proxy displacement > 12° from baseline for 6+ frames freezes the timer' },
    { error: 'Extended leg dropped or pulled back in', cameraDetection: 'Lifted ankle returns near the standing ankle, or feet narrow back toward shoulder width → foot-dropped (recoverable)' },
    { error: 'Arms came down from the star', cameraDetection: 'Both wrists fall below the shoulders → arms-dropped coaching cue (timer keeps running)' },
    { error: 'User puts the foot down and stands up', cameraDetection: 'Shoulder Y rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Breathe slowly and evenly. Holding your breath tightens the body and makes balance harder.',
  modifications: {
    easier: ['Lower the extended leg slightly (keep just the toe off the floor)', 'Bring the arms to shoulder height instead of fully up', 'Hold a wall or chair lightly with one hand'],
    harder: ['Hold longer (45–60 s per side)', 'Lift the extended leg higher', 'Close your eyes for a few seconds at a time'],
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

  engineModule: 'star-pose',

  images: {
    hero: 'svg:star-pose-hero',
    steps: ['svg:star-pose-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/7LDx9QQnHHc',
};
