import type { ExerciseConfig } from './types';

export const seatedMarchConfig: ExerciseConfig = {
  id: 'seated-march',
  catalogCode: 'SR1',
  name: 'Seated March',
  category: 'senior-rehab',
  equipment: ['Sturdy chair'],
  primaryMuscles: ['Hip flexors', 'Quadriceps'],
  secondaryMuscles: ['Core', 'Tibialis anterior'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Pace (reps/min)'],
  instructions: [
    'Sit tall on a sturdy chair, facing the camera. Scoot forward so your back is off the backrest.',
    'Place both feet flat on the floor, hip-width apart. Rest your hands on your thighs or the seat edge.',
    'Lift one knee up toward your chest, as high as is comfortable. Keep your back tall — don\'t lean back.',
    'Lower that foot back to the floor with control, then lift the other knee. Alternate continuously.',
    'Keep a steady, comfortable rhythm — this is a gentle march, not a race.',
    'Breathe normally throughout. Stop if you feel any pinching in the hip or knee.',
  ],
  commonErrors: [
    { error: 'Barely lifting the knee', cameraDetection: 'Peak knee lift below threshold fires low-knee-lift' },
    { error: 'Leaning back to swing the leg up (momentum)', cameraDetection: 'Shoulder-midpoint drift tracked into the form score' },
    { error: 'Going too fast / jerky', cameraDetection: 'Very fast rep cadence triggers malformed-rep' },
    { error: 'Slouching in the chair', cameraDetection: 'Torso posture drift — engine tracks the shoulder line' },
  ],
  breathing: 'Breathe steadily — exhale gently as you lift each knee.',
  modifications: {
    easier: ['Lift the knee only a few inches', 'Slower tempo with a pause between legs', 'Hold the chair seat for extra support'],
    harder: ['Lift the knees higher toward the chest', 'Add a gentle arm swing in opposition', 'Faster (still controlled) cadence'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 20,
  defaultRestSec: 30,
  safetyChecks: [
    'I am using a sturdy, stable chair that will not tip or slide',
    'I have no acute hip or knee pain when lifting my knee',
    'I can sit upright without back support for the duration of a set',
  ],

  engineModule: 'seated-march',

  images: {
    hero: 'svg:seated-march-hero',
    steps: ['svg:seated-march-left-up', 'svg:seated-march-right-up'],
  },
  videoUrl: 'https://youtube.com/shorts/3uYm4pjByP0',
};
