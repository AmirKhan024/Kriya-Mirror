import type { ExerciseConfig } from './types';

export const chairDipConfig: ExerciseConfig = {
  id: 'chair-dip',
  catalogCode: 'C24',
  name: 'Chair Dip',
  category: 'bodyweight',
  equipment: ['Chair', 'Bench'],
  primaryMuscles: ['Triceps brachii'],
  secondaryMuscles: ['Anterior deltoid', 'Pectoralis major (lower)', 'Core (stabiliser)'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Elbow angle'],
  instructions: [
    'Sit on the edge of a sturdy chair. Place both hands on the front edge beside your hips, fingers pointing forward.',
    'Slide your hips off the chair. Feet flat on the floor, knees bent at roughly 90°. Arms nearly straight.',
    'Keep your back close to the chair. This is your starting position.',
    'Inhale, then lower your body by bending your elbows — aim for 90° elbow angle at the bottom.',
    'Keep your elbows tracking straight back, not flaring out to the sides.',
    'Push through your palms to straighten your arms back to the starting position. Exhale on the way up.',
  ],
  commonErrors: [
    { error: 'Elbows flaring out to the sides instead of tracking straight back', cameraDetection: 'Max elbow x drift > 0.06 from shoulder baseline fires elbow-flare' },
    { error: 'Body rocking forward or back to use momentum', cameraDetection: 'Shoulder midpoint x oscillates > 0.04 from baseline fires torso-swing' },
    { error: 'Shallow dip — not bending elbows enough', cameraDetection: 'Peak average elbow flex < 60° fires incomplete-dip' },
    { error: 'Hips drifting too far forward from the chair', cameraDetection: 'Detected as torso-swing when shoulder mid x drifts significantly' },
    { error: 'Bouncing at the bottom (ballistic rep)', cameraDetection: 'Rep duration < 400 ms OR shoulder velocity > 2.5 triggers malformed-rep' },
  ],
  breathing: 'Inhale on the way down (eccentric) → exhale on the way up (concentric).',
  modifications: {
    easier: ['Bend knees more (reduces bodyweight load)', 'Place feet on a lower surface', 'Use a higher chair (less range of motion)'],
    harder: ['Legs fully extended (feet further from chair)', 'Weighted dip (plate on lap)', 'Parallel bar dips'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute elbow or wrist pain',
    'I have no shoulder impingement or rotator cuff injury',
    'My chair is stable and will not slide',
  ],

  engineModule: 'chair-dip',

  images: {
    hero: 'svg:chair-dip-hero',
    steps: ['svg:chair-dip-start', 'svg:chair-dip-bottom'],
  },
  videoUrl: undefined,
};
