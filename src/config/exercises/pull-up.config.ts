import type { ExerciseConfig } from './types';

export const pullUpConfig: ExerciseConfig = {
  id: 'pull-up',
  catalogCode: 'K2',
  name: 'Pull-Up / Chin-Up',
  category: 'calisthenics',
  equipment: ['Pull-up bar', 'Doorframe bar', 'Gymnastic rings (advanced)'],
  primaryMuscles: ['Latissimus dorsi', 'Biceps brachii'],
  secondaryMuscles: ['Rhomboids', 'Rear deltoids', 'Core stabilizers', 'Forearm flexors'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Elbow ROM (deg)'],
  instructions: [
    'Hang from the bar with arms fully extended, hands shoulder-width apart (overhand for pull-up, underhand for chin-up).',
    'Engage your core and squeeze your glutes — your body should form a straight vertical line.',
    'Pull yourself up by driving your elbows toward your hips. Focus on squeezing the lats.',
    'Continue pulling until your chin clears the bar — eyes level or slightly above the bar.',
    'Lower yourself under control over a 2-3 count. Reach full arm extension at the bottom.',
    'Avoid swinging, kipping, or using momentum. Every rep should be strict.',
  ],
  commonErrors: [
    { error: 'Chin not clearing the bar (partial rep)', cameraDetection: 'Peak average elbow flex < 90° fires incomplete-pullup' },
    { error: 'Kipping / swinging the hips for momentum', cameraDetection: 'Hip X displacement > 0.06 from baseline sustained 6+ frames fires malformed-rep' },
    { error: 'Shoulder shrugging (traps dominating)', cameraDetection: 'Ear-shoulder gap < 75% of calibrated baseline gap fires shoulder-shrug' },
    { error: 'Not reaching full extension at the bottom', cameraDetection: 'Elbow flex > 25° at bottom of rep triggers early-state detection' },
    { error: 'Ballistic / bouncing reps', cameraDetection: 'Rep duration < 400 ms OR shoulder velocity > 3 nu/sec triggers malformed-rep' },
  ],
  breathing: 'Inhale at the bottom (dead hang) → exhale as you pull up (concentric). Inhale on the way down.',
  modifications: {
    easier: ['Assisted pull-up machine', 'Resistance band looped over bar', 'Negative-only pull-ups (jump to top, lower slowly)', 'Inverted rows'],
    harder: ['Weighted pull-ups (belt + plates)', 'L-sit pull-ups', 'Archer pull-ups', 'One-arm negatives'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 8,
  defaultRestSec: 90,
  safetyChecks: [
    'I have no acute shoulder or rotator cuff injury',
    'I have no elbow pain or tendonitis flare-up',
    'I have no wrist injury that prevents a full grip',
  ],

  engineModule: 'pull-up',

  images: {
    hero: 'svg:pull-up-hero',
    steps: ['svg:pull-up-hang', 'svg:pull-up-mid', 'svg:pull-up-top'],
  },
};
