import type { ExerciseConfig } from './types';

export const jumpingJacksConfig: ExerciseConfig = {
  id: 'jumping-jacks',
  catalogCode: 'JJ1',
  name: 'Jumping Jacks',
  category: 'bodyweight',
  equipment: ['Bodyweight', 'Open floor space'],
  primaryMuscles: ['Calves', 'Quadriceps', 'Deltoids', 'Cardiovascular system'],
  secondaryMuscles: ['Glutes', 'Hip abductors', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Pace (reps/min)'],
  instructions: [
    'Stand tall facing the camera with feet together and arms relaxed at your sides.',
    'In one motion, jump (or step) your feet wider than shoulder-width AND raise both arms straight overhead so your hands meet (or come close) above your head.',
    'Land softly through the balls of your feet, knees slightly bent to absorb impact.',
    'Reverse the motion: jump (or step) your feet back together AND swing both arms back down to your sides.',
    'Keep your torso upright and core engaged — no leaning side to side.',
    'Breathe in a steady rhythm — exhale on the way out, inhale on the way in.',
  ],
  commonErrors: [
    { error: 'Half-jacks — arms only OR feet only', cameraDetection: 'Peak combined openness < 50% of shoulder width fires incomplete-jack' },
    { error: 'Uneven arms or feet (one side lags)', cameraDetection: 'min(left, right) / max(left, right) < 0.70 fires malformed-rep' },
    { error: 'Bouncing without control / flailing', cameraDetection: 'Wrist Y velocity AND ankle X velocity both > 8.0 nu/sec triggers malformed-rep' },
    { error: 'Swinging the torso side to side', cameraDetection: 'Shoulder-midpoint X oscillates > 0.04 from baseline triggers torso-swing' },
  ],
  breathing: 'Exhale on the way out (arms up, feet apart) → inhale on the way in (arms down, feet together). Keep a steady rhythm.',
  modifications: {
    easier: ['Step-jacks (no jump — step one foot out at a time)', 'Half-jacks (arms only OR feet only)', 'Slower tempo'],
    harder: ['Cross-jacks (cross feet at the bottom)', 'Plyometric jacks (explosive vertical)', 'Squat-jacks (jack into a squat)'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 20,
  defaultRestSec: 30,
  safetyChecks: [
    'I have no acute knee or ankle pain',
    'I have no balance issues that make jumping unsafe',
    'I am not pregnant (avoid plyometric impact in 2nd / 3rd trimester)',
    'I have enough clear space around me to swing my arms overhead',
  ],

  engineModule: 'jumping-jacks',

  images: {
    hero: 'svg:jumping-jacks-hero',
    steps: ['svg:jumping-jacks-closed', 'svg:jumping-jacks-open'],
  },
  videoUrl: 'https://youtube.com/shorts/7Pxr4xOrhNk?si=L4aYxsMSO5TUYw0S',
};
