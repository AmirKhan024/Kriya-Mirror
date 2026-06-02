import type { ExerciseConfig } from './types';

export const sitToStandConfig: ExerciseConfig = {
  id: 'sit-to-stand',
  catalogCode: 'SR2 — Sit-to-Stand',
  name: 'Sit-to-Stand',
  category: 'senior-rehab',
  equipment: ['Sturdy chair'],
  primaryMuscles: ['Quadriceps', 'Glutes'],
  secondaryMuscles: ['Hamstrings', 'Core', 'Calves'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Time'],
  instructions: [
    'Place a sturdy chair side-on to the camera and sit toward the front edge.',
    'Feet flat on the floor about hip-width, shins roughly vertical, chest tall.',
    'Lean your chest forward slightly, then push through your heels and stand all the way up.',
    'Stand tall with knees straight at the top — squeeze your glutes.',
    'Lower back down slowly and with control until you are seated again.',
    'Repeat. Breathe out as you stand, in as you sit. Use armrests only if you need to.',
  ],
  commonErrors: [
    { error: 'Not standing all the way up (half-rep)', cameraDetection: 'Knee did not extend below ~25° — fires incomplete-stand' },
    { error: 'Dropping back into the chair (using momentum)', cameraDetection: 'Rep duration < 300 ms or ballistic hip velocity triggers malformed-rep' },
    { error: 'Plopping down too fast on the way back', cameraDetection: 'Lower with control — the engine counts on the way up' },
    { error: 'Knees caving inward as you rise', cameraDetection: 'Side-camera variant tracks knee path' },
  ],
  breathing: 'Exhale and brace your core as you stand. Inhale as you lower back down under control.',
  modifications: {
    easier: ['Use a higher chair or add a cushion', 'Push off the armrests / your thighs', 'Fewer reps'],
    harder: ['Lower chair', 'Cross arms over your chest (no hands)', 'Hold a light weight at your chest', 'Pause 2s standing'],
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
  defaultRestSec: 45,
  safetyChecks: [
    'I have a sturdy chair that will not slide or tip',
    'I have no acute knee or hip pain that standing makes worse',
    'I can stand up from a chair on my own, or have support nearby',
  ],

  engineModule: 'sit-to-stand',

  images: {
    hero: 'svg:sit-to-stand-hero',
    steps: ['svg:sit-to-stand-seated', 'svg:sit-to-stand-hero', 'svg:sit-to-stand-shallow'],
  },
  videoUrl: 'https://youtube.com/shorts/cUz_TSy7_fw?si=vYmTrDvncAQSKMUH',
};
