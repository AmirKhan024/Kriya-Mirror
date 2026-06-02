import type { ExerciseConfig } from './types';

export const walkingLungeConfig: ExerciseConfig = {
  id: 'walking-lunge',
  catalogCode: 'C-WL',
  name: 'Walking Lunge',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Glutes', 'Quadriceps'],
  secondaryMuscles: ['Hamstrings', 'Calves', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Steps'],
  instructions: [
    'Stand tall with feet hip-width apart, hands on hips or arms at your sides.',
    'Step your right foot forward into a long stride — long enough that both knees can bend to 90°.',
    'Lower your hips straight down. Front knee tracks over your front foot (not past your toes).',
    'Back knee drops toward the floor — without slamming. Torso stays upright.',
    'Drive through your right heel to stand — but instead of returning, step your LEFT foot forward.',
    'Alternate legs continuously. Each step counts as one rep per side.',
  ],
  commonErrors: [
    { error: 'Front knee caving inward (valgus collapse)', cameraDetection: 'Front knee.x drift toward midline vs baseline knee width' },
    { error: 'Excessive forward lean (trunk past 55°)', cameraDetection: 'Hip–shoulder angle' },
    { error: 'Incomplete depth — front thigh well above parallel', cameraDetection: 'Peak front-knee flex < 50°' },
    { error: 'Steps too short (shallow lunge)', cameraDetection: 'Front–back leg flex gap < 15°' },
    { error: 'Rushing the movement (ballistic step)', cameraDetection: 'Step duration < 400 ms' },
  ],
  breathing: 'Inhale as you step and lower → exhale as you drive up and forward.',
  modifications: {
    easier: ['Static split squat (return to start)', 'Shorter range of motion', 'Hold a chair for balance while stationary'],
    harder: ['Add dumbbells', 'Increase step length', 'Weighted vest', 'Pause at bottom (2s)'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 20,   // 20 steps = 10 per leg
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute knee pain or injury (especially in the front knee)',
    'I have no hip flexor strain or recent hip injury',
    'I have enough clear floor space to walk forward (at least 4–5 steps)',
  ],

  engineModule: 'walking-lunge',

  images: {
    hero: 'svg:walking-lunge-hero',
    steps: ['svg:walking-lunge-stand', 'svg:walking-lunge-mid', 'svg:walking-lunge-bottom'],
  },
  videoUrl: undefined,
};
