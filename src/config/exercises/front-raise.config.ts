import type { ExerciseConfig } from './types';

export const frontRaiseConfig: ExerciseConfig = {
  id: 'front-raise',
  catalogCode: 'B8',
  name: 'Front Raise',
  category: 'strength-isolation',
  equipment: ['Dumbbells', 'Plate', 'Resistance band', 'Bodyweight (air-raise for form practice)'],
  primaryMuscles: ['Anterior deltoid'],
  secondaryMuscles: ['Pectoralis major (clavicular head)', 'Serratus anterior', 'Core (anti-extension)'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Shoulder flexion angle'],
  instructions: [
    'Stand FACING the camera with feet hip-width and a slight knee bend. Dumbbells or hands at your sides, palms facing your thighs.',
    'Keep your arms straight (a soft elbow bend is fine). Raise BOTH arms STRAIGHT FORWARD in front of you in one slow, controlled motion.',
    'Stop when your wrists are at shoulder height (arms horizontal in front of you). Do NOT raise above shoulder height — that\'s an overhead press, not a front raise.',
    'Lower under control over a 3-count back to your sides. Reach full at-side extension at the bottom.',
    'Keep your torso completely still — no leaning back or swinging. The work happens at the shoulder, not the hips.',
    'Inhale on the way down, exhale on the way up.',
  ],
  commonErrors: [
    { error: 'Half-reps — arms not reaching shoulder height', cameraDetection: 'Peak shoulder flexion < 75° fires incomplete-raise' },
    { error: 'Going overhead — that\'s a shoulder press, not a front raise', cameraDetection: 'Peak shoulder flexion > 130° fires arms-too-high' },
    { error: 'Going lateral — that\'s a lateral raise, not a front raise', cameraDetection: 'Wrist-outward ratio > 0.4 fires arms-out-not-front' },
    { error: 'One arm lagging the other', cameraDetection: '|left peak − right peak| > 25° fires arm-asymmetry' },
    { error: 'Bouncing the weight / ballistic motion', cameraDetection: 'Rep duration < 400 ms OR wrist Y velocity > 4.0 nu/sec triggers malformed-rep' },
  ],
  breathing: 'Inhale on the way down (eccentric) → exhale on the way up (concentric).',
  modifications: {
    easier: ['Single-arm front raise (one arm at a time)', 'Lighter weight / bodyweight', 'Seated front raise (eliminates torso swing)'],
    harder: ['Alternating front raise', 'Plate raise (hold a single plate with both hands)', 'Slow eccentric (4-count lower)'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 12,
  defaultRestSec: 45,
  safetyChecks: [
    'I have no acute shoulder pain or rotator-cuff injury',
    'I have no neck pain that worsens with arm elevation',
    'I have no recent shoulder dislocation or instability',
  ],

  engineModule: 'front-raise',

  images: {
    hero: 'svg:front-raise-hero',
    steps: ['svg:front-raise-down', 'svg:front-raise-mid', 'svg:front-raise-top'],
  },
  videoUrl: 'https://youtube.com/shorts/h9xfpTrAvkE',
};
