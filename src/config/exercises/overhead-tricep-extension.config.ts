import type { ExerciseConfig } from './types';

export const overheadTricepExtensionConfig: ExerciseConfig = {
  id: 'overhead-tricep-extension',
  catalogCode: 'B6',
  name: 'Overhead Tricep Extension',
  category: 'strength-isolation',
  equipment: ['Dumbbell', 'Barbell / EZ Bar', 'Resistance band'],
  primaryMuscles: ['Triceps brachii (long head)'],
  secondaryMuscles: ['Anconeus', 'Core (stability)'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Elbow angle ROM'],
  instructions: [
    'Stand tall with feet shoulder-width. Hold one dumbbell with both hands overhead — arms fully extended, palms cupped around the handle.',
    'Keep your upper arms locked vertical alongside your head. Only the forearms move.',
    'Lower the dumbbell behind your head by bending at the elbows until the forearms are roughly parallel to the floor.',
    'Drive the weight back overhead by extending your elbows until your arms are fully straight.',
    'Squeeze your triceps hard at the top of each rep. Keep your core braced throughout.',
    'Inhale on the way down (eccentric), exhale on the way up (concentric).',
  ],
  commonErrors: [
    { error: 'Elbows flaring outward instead of staying close to the head', cameraDetection: 'Elbow X position drifts outside baseline shoulder X by > 0.05 normalized units' },
    { error: 'Incomplete range of motion — not lowering far enough', cameraDetection: 'Wrist did not reach near-elbow height; tricepExtDeg stays > 40° (< 50° of arc)' },
    { error: 'Swinging the torso to assist the movement', cameraDetection: 'Shoulder-midpoint X oscillates > 0.04 from baseline' },
    { error: 'Ballistic reps — dropping the weight too fast', cameraDetection: 'Rep duration < 400 ms OR wrist velocity > 4.0 nu/sec' },
  ],
  breathing: 'Inhale on the way down (lowering the weight behind your head) → exhale on the way up (pressing overhead).',
  modifications: {
    easier: ['Lighter dumbbell', 'Resistance band (loop overhead, pull down)', 'Seated version (back supported)'],
    harder: ['Barbell / EZ Bar overhead extension', 'Single-arm overhead extension', 'Slow eccentric (4-count lowering)'],
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
    'I have no shoulder impingement or rotator cuff injury',
    'I have no wrist injury that prevents gripping a weight overhead',
  ],

  engineModule: 'overhead-tricep-extension',

  images: {
    hero: 'svg:overhead-tricep-extension-hero',
    steps: [
      'svg:overhead-tricep-extension-extended',
      'svg:overhead-tricep-extension-lowered',
    ],
  },
  videoUrl: undefined,
};
