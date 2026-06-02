import type { ExerciseConfig } from './types';

export const lateralRaiseConfig: ExerciseConfig = {
  id: 'lateral-raise',
  catalogCode: 'B7',
  name: 'Lateral Raise',
  category: 'strength-isolation',
  equipment: ['Dumbbells', 'Resistance band', 'Bodyweight (air-raise for form practice)'],
  primaryMuscles: ['Medial deltoid'],
  secondaryMuscles: ['Anterior deltoid', 'Posterior deltoid', 'Trapezius'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Peak angle ROM'],
  instructions: [
    'Stand tall with feet hip-width apart. Hold dumbbells (or hands) at your sides, palms facing your body.',
    'Keep a slight bend in your elbows — they should NOT lock straight.',
    'Raise both arms OUT TO THE SIDES until your wrists are level with your shoulders (about 90°).',
    'Keep your wrists in line with your elbows — do not flick or shrug.',
    'Lower under control over a 3-count. Reach a full pause at the bottom with arms at your sides.',
    'Keep your torso still — no swinging or rocking. Let your shoulders do the work.',
    'Exhale on the way up, inhale on the way down.',
  ],
  commonErrors: [
    { error: 'Swinging the torso to lift the weight (using momentum)', cameraDetection: 'Shoulder-midpoint x oscillates > 0.04 from baseline' },
    { error: 'Half-reps — not raising to shoulder height', cameraDetection: 'Peak shoulder-abduction angle < 75° fires incomplete-raise' },
    { error: 'One arm lagging the other (asymmetric raise)', cameraDetection: 'Left vs right peak angle differs by > 15° fires arm-asymmetry' },
    { error: 'Bouncing / jerking the weight up (ballistic rep)', cameraDetection: 'Rep duration < 400 ms OR wrist velocity > 4.0 nu/sec triggers malformed-rep' },
    { error: 'Shrugging shoulders up toward ears', cameraDetection: 'Shoulder Y rises > 0.04 above baseline during the rep' },
  ],
  breathing: 'Exhale on the way up (concentric) → inhale on the way down (eccentric).',
  modifications: {
    easier: ['Lighter dumbbells', 'Resistance band (lighter resistance)', 'Single-arm at a time'],
    harder: ['Heavier dumbbells', 'Pause at the top for 2 s', 'Cable lateral raise', 'Front raise + lateral raise combo'],
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
    'I have no recent neck or trap strain',
    'I have no wrist injury that prevents gripping a weight',
  ],

  engineModule: 'lateral-raise',

  images: {
    hero: 'svg:lateral-raise-hero',
    steps: ['svg:lateral-raise-down', 'svg:lateral-raise-mid', 'svg:lateral-raise-top'],
  },
  videoUrl: 'https://youtube.com/shorts/G-piLwLu0d4',
};
