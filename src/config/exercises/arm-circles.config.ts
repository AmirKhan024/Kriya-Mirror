import type { ExerciseConfig } from './types';

export const armCirclesConfig: ExerciseConfig = {
  id: 'arm-circles',
  catalogCode: 'J3',
  name: 'Arm Circles',
  category: 'mobility',
  equipment: ['Bodyweight', 'Open floor space'],
  primaryMuscles: ['Deltoids (all heads)', 'Rotator cuff'],
  secondaryMuscles: ['Trapezius', 'Rhomboids', 'Serratus anterior'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Direction (forward/backward)', 'Pace'],
  instructions: [
    'Stand FACING the camera with feet hip-width. Arms relaxed at your sides to start.',
    'Trace LARGE arm circles — sweep both arms up and overhead, then back down to your sides.',
    'Each rep = one full sweep (down → overhead → down). Touch the bottom and the top of every rep.',
    'Do half the set FORWARD (arms come UP in front and DOWN behind), then reverse to BACKWARD.',
    'Keep your torso still — only the shoulders move. No leaning.',
    'Breathe steadily — these are mobility / warm-up, not strength.',
  ],
  commonErrors: [
    { error: "Half-reps — arms don't reach overhead", cameraDetection: 'Peak shoulder abduction < 140° fires incomplete-raise' },
    { error: 'One arm leading too far ahead of the other', cameraDetection: '|left peak − right peak| > 30° fires arm-asymmetry' },
    { error: 'Going too fast / flailing', cameraDetection: 'Rep duration < 1.5 s OR wrist Y velocity > 5.0 nu/sec → malformed-rep' },
    { error: 'Swinging the torso to gain momentum', cameraDetection: 'Form-score tracks shoulder-midpoint drift (chip disabled — silent penalty)' },
  ],
  breathing: 'Steady, relaxed breathing throughout — mobility / warm-up, not breath-paced strength.',
  modifications: {
    easier: ['Small circles (shorter ROM)', 'One arm at a time', 'Slower pace'],
    harder: ['Larger circles (full shoulder ROM)', 'Add light dumbbells', 'Combo forward + backward in single set'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 2,
  defaultRepsPerSet: 15,
  defaultRestSec: 20,
  safetyChecks: [
    'I have no acute shoulder pain or rotator-cuff injury',
    'I have no recent shoulder dislocation or impingement',
  ],

  engineModule: 'arm-circles',

  images: {
    hero: 'svg:arm-circles-hero',
    steps: ['svg:arm-circles-forward', 'svg:arm-circles-backward'],
  },
  videoUrl: 'https://youtube.com/shorts/lzR7tzI1JUI',
};
