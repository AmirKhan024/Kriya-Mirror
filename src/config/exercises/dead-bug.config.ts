import type { ExerciseConfig } from './types';

export const deadBugConfig: ExerciseConfig = {
  id: 'dead-bug',
  catalogCode: 'C28',
  name: 'Dead Bug',
  category: 'bodyweight',
  equipment: ['None (floor)'],
  primaryMuscles: ['Core', 'Transverse Abdominis'],
  secondaryMuscles: ['Hip Flexors', 'Shoulder Stabilisers'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Alignment'],
  instructions: [
    'Lie flat on your back on the floor. Extend both arms straight up toward the ceiling — perpendicular to your torso.',
    'Bend your knees to 90° and raise your legs so your shins are parallel to the floor (tabletop position).',
    'Brace your core and press your lower back firmly into the floor. Do not let it arch.',
    'Slowly lower your right arm overhead while simultaneously extending your left leg toward the floor. Keep both hovering just above the floor.',
    'Return both limbs to the starting position with control. Squeeze your core throughout.',
    'Repeat on the other side — left arm lowers while right leg extends. That is one rep.',
  ],
  commonErrors: [
    { error: 'Lower back arching off the floor', cameraDetection: 'Hip Y position rises above calibrated floor level' },
    { error: 'Leg not reaching full extension', cameraDetection: 'Hip-knee-ankle angle does not reach 140° at bottom of rep' },
    { error: 'Moving too fast (ballistic extension)', cameraDetection: 'Rep duration < 600 ms triggers malformed-rep' },
    { error: 'Hips rocking side to side', cameraDetection: 'Hip Y deviates from baseline by more than threshold' },
  ],
  breathing: 'Exhale as you extend arm and leg → inhale as you return to start.',
  modifications: {
    easier: ['Arms only (keep feet on floor)', 'Legs only (keep arms at sides)', 'Reduced range of motion'],
    harder: ['Hold at full extension for 2–3 seconds', 'Add ankle weights', 'Eyes closed'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower back pain or injury',
    'I have no shoulder pain that prevents raising arms overhead',
    'I have no hip flexor or abdominal injury',
  ],
  engineModule: 'dead-bug',
  images: {
    hero: 'svg:dead-bug-hero',
    steps: ['svg:dead-bug-top', 'svg:dead-bug-mid', 'svg:dead-bug-bottom'],
  },
  videoUrl: undefined,
};
