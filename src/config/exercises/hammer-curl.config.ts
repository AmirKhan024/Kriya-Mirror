import type { ExerciseConfig } from './types';

export const hammerCurlConfig: ExerciseConfig = {
  id: 'hammer-curl',
  catalogCode: 'B2',
  name: 'Hammer Curl',
  category: 'strength-isolation',
  equipment: ['Dumbbells', 'Resistance band'],
  primaryMuscles: ['Brachialis', 'Brachioradialis'],
  secondaryMuscles: ['Biceps brachii', 'Forearm flexors'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Elbow angle ROM'],
  instructions: [
    'Stand tall with feet shoulder-width apart. Hold dumbbells at your sides with palms facing each other (neutral grip — thumbs pointing up).',
    'Pin your elbows to your ribs — they should NOT drift forward during the curl.',
    'Curl both weights toward your shoulders by bending at the elbow. Keep the neutral grip throughout the entire movement.',
    'Lower under control over a 3-count. Reach full elbow extension at the bottom of each rep.',
    'Keep your torso still — no swinging or rocking. Let your brachialis and brachioradialis do the work.',
    'Inhale on the way down, exhale on the way up.',
  ],
  commonErrors: [
    { error: 'Swinging the torso to lift the weight (using momentum)', cameraDetection: 'Shoulder-midpoint x oscillates > 0.04 from baseline' },
    { error: 'Elbows drifting forward of the ribs', cameraDetection: 'Average elbow x drifts > 0.06 from baseline elbow position' },
    { error: 'Half-reps — not curling high enough', cameraDetection: 'Peak average elbow flex < 85° fires incomplete-curl' },
    { error: 'Bouncing the weight (ballistic rep)', cameraDetection: 'Rep duration < 400 ms OR wrist velocity > 4.0 nu/sec triggers malformed-rep' },
    { error: 'One arm lagging the other (unilateral cheat)', cameraDetection: 'min(left, right) / max(left, right) < 0.70 fires malformed-rep' },
  ],
  breathing: "Inhale on the way down (eccentric) → exhale on the way up (concentric, when you're working hardest).",
  modifications: {
    easier: ['Lighter dumbbells', 'Resistance band (lighter resistance options)', 'Seated hammer curls (eliminates torso swing)'],
    harder: ['Cross-body hammer curl', 'Incline hammer curl', 'Zottman curl (supinate at top, pronate on way down)'],
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
    'I have no recent biceps or brachialis tendon injury',
  ],

  engineModule: 'hammer-curl',

  images: {
    hero: 'svg:hammer-curl-hero',
    steps: ['svg:hammer-curl-extended', 'svg:hammer-curl-mid', 'svg:hammer-curl-top'],
  },
};
