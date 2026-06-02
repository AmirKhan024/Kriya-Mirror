import type { ExerciseConfig } from './types';

export const obliqueSideBendConfig: ExerciseConfig = {
  id: 'oblique-side-bend',
  catalogCode: 'O — Standing Side Bend',
  name: 'Standing Oblique Side Bend',
  category: 'mobility',
  equipment: ['Bodyweight'],
  primaryMuscles: ['Obliques', 'Quadratus Lumborum'],
  secondaryMuscles: ['Erector Spinae', 'Lats'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (each side)', 'Lean angle'],
  instructions: [
    'Stand tall facing the camera, feet hip-width apart, arms relaxed at your sides.',
    'Keeping your hips facing forward and level, bend your torso directly to one side.',
    'Slide that hand down the outside of your thigh — reach as far as is comfortable.',
    'Bend purely sideways: do not lean forward or twist, and do not let your hips swing out.',
    'Return smoothly to standing tall, then bend to the other side. Alternate, or do all reps one side then switch.',
    'Exhale as you bend, inhale as you return to upright.',
  ],
  commonErrors: [
    { error: 'Barely bending (half-rep)', cameraDetection: 'Peak lateral lean < 18° fires incomplete-bend' },
    { error: 'Whipping the bend with momentum', cameraDetection: 'Rep duration < 300 ms or high shoulder velocity triggers malformed-rep' },
    { error: 'Leaning forward instead of sideways', cameraDetection: 'Bend is measured in the frontal plane (shoulder-vs-hip lateral offset)' },
    { error: 'Hips swinging out the opposite way', cameraDetection: 'Lean is measured shoulder-midpoint relative to hip-midpoint' },
  ],
  breathing: 'Exhale as you bend to the side, inhale as you lengthen back up to standing.',
  modifications: {
    easier: ['Smaller range of motion', 'One hand on the hip for support', 'Slower tempo'],
    harder: ['Reach the top arm overhead for a longer lever', 'Hold a light dumbbell in the bending-side hand', 'Pause 2s at the bottom'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 2,
  defaultRepsPerSet: 12,
  defaultRestSec: 30,
  safetyChecks: [
    'I have no acute lower-back pain or recent spinal injury',
    'I have no condition that makes side bending dizzy or painful',
    'I can stand and bend sideways through a comfortable range',
  ],

  engineModule: 'oblique-side-bend',

  images: {
    hero: 'svg:oblique-side-bend-hero',
    steps: ['svg:oblique-side-bend-hero', 'svg:oblique-side-bend-bent', 'svg:oblique-side-bend-shallow'],
  },
  videoUrl: 'https://youtube.com/shorts/H5bjGU7hUeA?si=5osvAoSa3l146fkh',
};
