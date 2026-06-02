import type { ExerciseConfig } from './types';

export const curtsyLungeConfig: ExerciseConfig = {
  id: 'curtsy-lunge',
  catalogCode: 'C-CL',
  name: 'Curtsy Lunge',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Glutes (medius)', 'Quadriceps'],
  secondaryMuscles: ['Hamstrings', 'Adductors', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps'],
  instructions: [
    'Stand with feet hip-width apart, hands on hips or clasped at chest.',
    'Step your right foot diagonally behind and across your left leg — like a curtsy.',
    'Lower your right knee toward the floor, bending your front (left) knee to ~90°.',
    'Keep your hips facing forward throughout. Do not let the rear hip swing out.',
    'Drive through your front heel to return to standing.',
    'Alternate sides: left foot steps behind right leg next.',
  ],
  commonErrors: [
    { error: 'Hips rotating outward as leg crosses behind', cameraDetection: 'Rear hip Y rising above baseline during descent' },
    { error: 'Front knee caving inward (valgus)', cameraDetection: 'Front knee X drifting inside ankle X' },
    { error: 'Insufficient crossover (not enough curtsy angle)', cameraDetection: 'Rear ankle X does not cross past midline by 8% hip-width' },
    { error: 'Shallow depth (front thigh not reaching parallel)', cameraDetection: 'Front knee flexion > 100° at bottom' },
    { error: 'Excessive forward trunk lean', cameraDetection: 'Torso angle > 45° from vertical' },
  ],
  breathing: 'Inhale on the way down → exhale as you drive back up to standing.',
  modifications: {
    easier: ['Reverse lunge (no crossover)', 'Hold chair for balance', 'Reduce range of motion'],
    harder: ['Add dumbbells', 'Pulse at bottom (3 counts)', 'Add knee drive on the way up'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute knee pain that worsens with deep knee bend',
    'I have no acute hip pain or recent hip surgery',
    'I have sufficient balance to perform single-leg movements',
  ],

  engineModule: 'curtsy-lunge',
  images: {
    hero: 'svg:curtsy-lunge-hero',
    steps: ['svg:curtsy-lunge-start', 'svg:curtsy-lunge-cross', 'svg:curtsy-lunge-bottom'],
  },
  videoUrl: undefined,
};
