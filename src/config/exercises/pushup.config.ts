import type { ExerciseConfig } from './types';

export const pushupConfig: ExerciseConfig = {
  id: 'pushup',
  catalogCode: 'C1',
  name: 'Push-Up',
  category: 'bodyweight',
  equipment: ['None (floor)'],
  primaryMuscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps'],
  secondaryMuscles: ['Core', 'Serratus Anterior'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Tempo', 'Variation'],
  instructions: [
    'Lie face-down. Place hands slightly wider than your shoulders, fingers pointing forward.',
    'Push up onto your hands and toes. Body forms a straight line from head to heels.',
    'Brace your core — no sagging hips or piking.',
    'Lower your chest toward the floor. Keep elbows at about 45° from your body — do not flare them out.',
    'Press back to full arm extension. Squeeze chest at the top.',
    'Breathe in on the way down, breathe out on the way up. Repeat.',
  ],
  commonErrors: [
    { error: 'Hips sagging toward the floor', cameraDetection: 'Hip landmark drops below shoulder-ankle line' },
    { error: 'Hips piking (butt in the air)', cameraDetection: 'Hip landmark rises above shoulder-ankle line' },
    { error: 'Elbows flaring out wide (90° from body)', cameraDetection: 'Elbow X position vs shoulder X at bottom of rep' },
    { error: 'Incomplete depth — chest doesn’t reach low enough', cameraDetection: 'Peak elbow flexion < 60° on rep' },
    { error: 'Bouncing off the floor (ballistic rep)', cameraDetection: 'Rep duration < 400 ms triggers malformed-rep' },
  ],
  breathing: 'Inhale on the descent → hold momentarily at the bottom → exhale on the press up.',
  modifications: {
    easier: ['Wall push-up', 'Incline push-up (hands on bench)', 'Knee push-up'],
    harder: ['Decline push-up (feet elevated)', 'Diamond push-up', 'Archer push-up'],
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
    'I have no acute shoulder pain or rotator-cuff injury',
    'I have no wrist injury that prevents weight-bearing on my palms',
    'I have no recent chest, elbow, or core injury',
  ],

  engineModule: 'pushup',

  images: {
    hero: 'svg:pushup-hero',
    steps: ['svg:pushup-top', 'svg:pushup-mid', 'svg:pushup-bottom'],
  },
  videoUrl: 'https://youtube.com/shorts/04FqT6lC0i4',
};
