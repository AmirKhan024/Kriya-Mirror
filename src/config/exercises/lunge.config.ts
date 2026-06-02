import type { ExerciseConfig } from './types';

export const lungeConfig: ExerciseConfig = {
  id: 'lunge',
  catalogCode: 'C2',
  name: 'Forward Lunge',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps', 'Glutes'],
  secondaryMuscles: ['Hamstrings', 'Calves', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (each leg)', 'Front-leg depth'],
  instructions: [
    'Stand tall with feet hip-width apart, arms relaxed at your sides.',
    'Step one foot forward into a long stride — long enough that both knees can bend to 90°.',
    'Lower your hips straight down. Front knee tracks over your front foot (not past your toes).',
    'Back knee drops toward the floor — without slamming. Torso stays upright.',
    'Drive through your front heel to return to the start.',
    'Alternate legs each rep. Breathe in on the way down, out on the way up.',
  ],
  commonErrors: [
    { error: 'Front knee caving inward (valgus collapse)', cameraDetection: 'Front knee.x drift toward midline vs baseline knee width' },
    { error: 'Excessive forward lean (trunk past 55°)', cameraDetection: 'Hip–shoulder angle' },
    { error: 'Front knee tracking too far past the toes', cameraDetection: 'Side-camera only — disabled in front-camera mode' },
    { error: 'Incomplete depth — front thigh well above parallel', cameraDetection: 'Front-knee peak flex < MIN_REP_DEPTH (50°)' },
    { error: 'Bouncing off the back knee (ballistic rep)', cameraDetection: 'Rep duration < 400 ms triggers malformed-rep' },
    { error: 'Both legs flexing equally (squatting instead of lunging)', cameraDetection: 'Front vs back peak gap < 20° triggers malformed-rep' },
  ],
  breathing: 'Inhale as you step and lower → brace at the bottom → exhale as you press back up.',
  modifications: {
    easier: ['Static split squat (no step)', 'Hold a chair for balance', 'Shorter range of motion'],
    harder: ['Walking lunge', 'Reverse lunge (knee comfort)', 'Bulgarian split squat (rear foot elevated)', 'Weighted lunge (dumbbells)'],
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

  engineModule: 'lunge',

  images: {
    hero: 'svg:lunge-hero',
    steps: ['svg:lunge-stand', 'svg:lunge-mid', 'svg:lunge-bottom'],
  },
  videoUrl: 'https://youtube.com/shorts/2rtQ15FaNe8',
};
