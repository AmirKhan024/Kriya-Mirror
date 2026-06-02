import type { ExerciseConfig } from './types';

export const bicepCurlConfig: ExerciseConfig = {
  id: 'bicep-curl',
  catalogCode: 'B1',
  name: 'Bicep Curl',
  category: 'strength-isolation',
  equipment: ['Dumbbells', 'Barbell', 'Resistance band', 'Bodyweight (air-curl for form practice)'],
  primaryMuscles: ['Biceps brachii'],
  secondaryMuscles: ['Brachialis', 'Brachioradialis', 'Forearm flexors'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Elbow angle ROM'],
  instructions: [
    'Stand tall with feet shoulder-width apart. Dumbbells (or hands) at your sides, palms facing forward.',
    'Pin your elbows to your ribs — they should NOT drift forward during the curl.',
    'Curl both weights toward your shoulders by bending at the elbow. Squeeze your biceps at the top.',
    'Lower under control over a 3-count. Reach full elbow extension at the bottom of each rep.',
    'Keep your torso still — no swinging or rocking. Let your biceps do the work.',
    'Inhale on the way down, exhale on the way up.',
  ],
  commonErrors: [
    { error: 'Swinging the torso to lift the weight (using momentum)', cameraDetection: 'Shoulder-midpoint x oscillates > 0.04 from baseline' },
    { error: 'Elbows drifting forward of the ribs', cameraDetection: 'Average elbow x drifts > 0.06 from baseline elbow position' },
    { error: 'Half-reps — not curling high enough', cameraDetection: 'Peak average elbow flex < 90° fires incomplete-curl' },
    { error: 'Bouncing the weight (ballistic rep)', cameraDetection: 'Rep duration < 400 ms OR wrist velocity > 1.5 nu/sec triggers malformed-rep' },
    { error: 'One arm lagging the other (unilateral cheat)', cameraDetection: 'min(left, right) / max(left, right) < 0.70 fires malformed-rep' },
  ],
  breathing: 'Inhale on the way down (eccentric) → exhale on the way up (concentric, when you’re working hardest).',
  modifications: {
    easier: ['Lighter dumbbells', 'Resistance band (lighter resistance options)', 'Seated curls (eliminates torso swing)'],
    harder: ['Hammer Curl (neutral grip)', 'Concentration Curl (one arm, fixed elbow)', 'Incline Dumbbell Curl', '21s (7 bottom-half + 7 top-half + 7 full)'],
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
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute elbow pain or tendonitis flare-up',
    'I have no wrist injury that prevents gripping a weight',
    'I have no recent biceps tendon injury',
  ],

  engineModule: 'bicep-curl',

  images: {
    hero: 'svg:bicep-curl-hero',
    steps: ['svg:bicep-curl-extended', 'svg:bicep-curl-mid', 'svg:bicep-curl-top'],
  },
  videoUrl: 'https://youtube.com/shorts/ckhfQgBfj6w',
};
