import type { ExerciseConfig } from './types';

export const lateralLungeConfig: ExerciseConfig = {
  id: 'lateral-lunge',
  catalogCode: 'C — Lateral Lunge',
  name: 'Lateral Lunge',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Adductors', 'Glutes', 'Quadriceps'],
  secondaryMuscles: ['Hamstrings', 'Hip stabilizers', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps (each side)', 'Working-leg depth'],
  instructions: [
    'Stand tall facing the camera, feet hip-width apart, arms relaxed (or hands at chest).',
    'Step one foot WIDE out to the side. Keep both feet pointing forward.',
    'Bend the stepped-out knee and sit your hips back and toward that side until the thigh nears parallel.',
    'Keep the OTHER leg STRAIGHT — press through its inner edge. Chest tall, do not collapse sideways.',
    'Drive through the bent leg to push back to standing, feet hip-width.',
    'Alternate sides each rep, or do all reps on one side then switch. Breathe in down, out up.',
  ],
  commonErrors: [
    { error: 'Bending the planted (straight) leg too — turning it into a squat', cameraDetection: 'Planted-knee flex > 30° fires leg-not-straight; too-small working-vs-planted gap rejects the rep' },
    { error: 'Working knee caving inward (valgus collapse)', cameraDetection: 'Working knee.x drift toward midline vs baseline knee width' },
    { error: 'Torso collapsing sideways over the bent leg', cameraDetection: 'Shoulder–hip line past 55° from vertical fires trunk-forward' },
    { error: 'No real weight shift — bending a knee in place', cameraDetection: 'Hip midpoint barely shifts toward the working side → rep rejected (malformed-rep)' },
    { error: 'Incomplete depth — barely bending', cameraDetection: 'Working-knee peak flex < MIN_REP_DEPTH (50°) fires incomplete-lunge' },
  ],
  breathing: 'Inhale as you step out and sink → brace at the bottom → exhale as you push back to standing.',
  modifications: {
    easier: ['Smaller step / shallower bend', 'Hold a chair for balance', 'Keep hands at chest for counterbalance'],
    harder: ['Cossack squat (deeper, heel down)', 'Goblet-loaded lateral lunge', 'Slow 3-second lowering'],
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
    'I have no acute knee, hip, or groin (adductor) injury',
    'I have enough hip mobility to step wide without pain',
    'I have no balance issues that make a wide stance unsafe',
  ],

  engineModule: 'lateral-lunge',

  images: {
    // Placeholder: reuse the forward-lunge illustration until a dedicated
    // Lateral Lunge (wide side-step) hero is drawn.
    hero: 'svg:lunge-hero',
    steps: ['svg:lunge-hero'],
  },
  videoUrl: 'https://youtu.be/MvpBUsQrt_4',
};
