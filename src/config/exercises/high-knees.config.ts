import type { ExerciseConfig } from './types';

export const highKneesConfig: ExerciseConfig = {
  id: 'high-knees',
  catalogCode: 'M9',
  name: 'High Knees',
  category: 'cardio',
  equipment: ['Bodyweight', 'Open floor space'],
  primaryMuscles: ['Hip flexors', 'Quadriceps', 'Calves', 'Cardiovascular system'],
  secondaryMuscles: ['Core (anti-rotation)', 'Glutes'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Pace (reps/min)'],
  instructions: [
    'Stand tall facing the camera, feet hip-width apart, arms relaxed at your sides or bent at your ribs.',
    'Drive one knee up toward your hip in one explosive motion — aim for knee at hip height (thigh parallel to the floor).',
    'As that foot returns to the floor, immediately drive the other knee up. Alternate continuously.',
    'Land softly through the balls of your feet — stay tall, don\'t hunch.',
    'Keep your torso upright and core braced — no leaning or rocking side to side.',
    'Breathe in a steady rhythm — short, sharp breaths in time with the steps.',
  ],
  commonErrors: [
    { error: 'Half-knees — knees barely lifting', cameraDetection: 'Peak knee lift < 30 % of shoulder width fires low-knee-lift' },
    { error: 'Going too fast / sloppy form', cameraDetection: 'Rep duration < 150 ms OR knee Y velocity > 8.0 nu/sec triggers malformed-rep' },
    { error: 'Swinging the torso side-to-side for momentum', cameraDetection: 'Shoulder-midpoint x oscillates > 0.04 from baseline triggers torso-swing' },
    { error: 'Hunching forward as you tire', cameraDetection: 'Sustained forward lean — engine tracks shoulder mid drift' },
  ],
  breathing: 'Short, sharp breaths in time with the steps — exhale on each knee drive.',
  modifications: {
    easier: ['March in place (no jumping — just lift knees slowly)', 'Bring knees to mid-thigh height instead of hip height', 'Slower tempo'],
    harder: ['Faster cadence (max reps/min)', 'Arm drive — pump arms in opposition to legs', 'High-knee sprint intervals'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 30,
  defaultRestSec: 30,
  safetyChecks: [
    'I have no acute knee or hip pain',
    'I have no balance issues that make rapid single-leg loading unsafe',
    'I am not pregnant (avoid plyometric impact in 2nd / 3rd trimester)',
  ],

  engineModule: 'high-knees',

  images: {
    hero: 'svg:high-knees-hero',
    steps: ['svg:high-knees-left-up', 'svg:high-knees-right-up'],
  },
  videoUrl: 'https://youtube.com/shorts/9xuYXOzImy8',
};
