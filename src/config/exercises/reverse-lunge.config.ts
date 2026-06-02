import type { ExerciseConfig } from './types';

export const reverseLungeConfig: ExerciseConfig = {
  id: 'reverse-lunge',
  catalogCode: 'C — Reverse Lunge',
  name: 'Reverse Lunge',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Glutes', 'Quadriceps'],
  secondaryMuscles: ['Hamstrings', 'Calves', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (each leg)', 'Front-leg depth'],
  instructions: [
    'Stand tall facing the camera, feet hip-width apart, arms relaxed at your sides.',
    'Step one foot straight back into a long stride.',
    'Lower your hips straight down until your FRONT thigh is parallel to the floor (front knee ~90°).',
    'Let your back knee drop toward the floor. Keep your torso upright — chest tall.',
    'Drive through your front heel to step the back foot in and return to standing.',
    'Alternate legs each rep, or do all reps on one leg then switch. Breathe in down, out up.',
  ],
  commonErrors: [
    { error: 'Front knee caving inward (valgus collapse)', cameraDetection: 'Front knee.x drift toward midline vs baseline knee width' },
    { error: 'Excessive forward lean (trunk past 55°)', cameraDetection: 'Hip–shoulder angle' },
    { error: 'Incomplete depth — front thigh well above parallel', cameraDetection: 'Front-knee peak flex < MIN_REP_DEPTH (50°) fires incomplete-lunge' },
    { error: 'Dropping too fast / bouncing', cameraDetection: 'Rep duration < 400 ms or ballistic hip velocity triggers malformed-rep' },
  ],
  breathing: 'Inhale as you step back and lower → brace at the bottom → exhale as you drive back up.',
  modifications: {
    easier: ['Static split squat (no step)', 'Hold a chair for balance', 'Shorter range of motion'],
    harder: ['Deficit reverse lunge (front foot on a step)', 'Rear-foot-elevated split squat', 'Weighted reverse lunge (dumbbells)'],
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
    'I have no acute knee pain or injury (especially in the front knee)',
    'I have no hip flexor strain or recent hip injury',
    'I have no balance issues that make single-leg loading unsafe',
  ],

  engineModule: 'reverse-lunge',

  images: {
    hero: 'svg:reverse-lunge-hero',
    steps: ['svg:reverse-lunge-hero', 'svg:reverse-lunge-bottom', 'svg:reverse-lunge-shallow'],
  },
  videoUrl: 'https://youtube.com/shorts/WwcM49jUqy0?si=12cTrEZ7rjmOy2ji',
};
