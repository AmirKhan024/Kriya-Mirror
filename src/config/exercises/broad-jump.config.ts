import type { ExerciseConfig } from './types';

export const broadJumpConfig: ExerciseConfig = {
  id: 'broad-jump',
  catalogCode: 'D13',
  name: 'Broad Jump',
  category: 'functional',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps', 'Glutes', 'Calves'],
  secondaryMuscles: ['Hamstrings', 'Core', 'Hip Flexors'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Jump power (hip rise)', 'Landing quality'],
  instructions: [
    'Stand facing the camera, feet shoulder-width apart, toes pointing forward.',
    'Bend your knees and swing your arms back to load.',
    'Explosively jump forward, swinging arms forward for momentum.',
    'Land softly on both feet simultaneously, bending your knees to absorb impact.',
    'Stand tall to complete the rep, then reset your position.',
  ],
  commonErrors: [
    { error: 'No loading dip before jump', cameraDetection: 'AIRBORNE state entered without LOADING state' },
    { error: 'Stiff-legged landing', cameraDetection: 'Knee flexion stays < 20° for 300ms after landing' },
    { error: 'Insufficient jump height', cameraDetection: 'Hip Y displacement < minimum threshold' },
    { error: 'Landing on heels', cameraDetection: 'Rapid hip descent without prior absorption phase' },
  ],
  breathing: 'Exhale explosively during the jump. Inhale on landing as you absorb.',
  modifications: {
    easier: ['Squat jump in place before progressing to forward distance', 'Reduce jump distance'],
    harder: ['Triple broad jump (3 consecutive jumps)', 'Add a pause at landing before resetting'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: false,
    cameraVision: 'full',
  },
  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 8,
  defaultRestSec: 90,
  safetyChecks: [
    'I have no knee or ankle injuries',
    'I have enough space ahead of me to jump safely',
    'I will land with soft knees — never locked out',
    'I will warm up calves and ankles before explosive jumping',
  ],
  engineModule: 'broad-jump',
  images: {
    hero: 'svg:broad-jump-hero',
    steps: [],
  },
};
