import type { ExerciseConfig } from './types';

export const cossackSquatConfig: ExerciseConfig = {
  id: 'cossack-squat',
  catalogCode: 'J25 — Cossack Squat',
  name: 'Cossack Squat',
  category: 'mobility',
  equipment: ['None'],
  primaryMuscles: ['Adductors', 'Glutes', 'Quadriceps'],
  secondaryMuscles: ['Hamstrings', 'Hip mobility', 'Ankles', 'Core'],
  difficulty: 'Advanced',
  trackFields: ['Sets', 'Reps (each side)', 'Working-leg depth'],
  instructions: [
    'Stand tall facing the camera in a WIDE stance — feet well past shoulder-width, toes slightly out.',
    'Shift your weight onto one leg and sit your hips down and back over that foot, bending the knee deeply.',
    'Keep the OTHER leg STRAIGHT — heel down or toes up, inner edge long. Chest tall, do not collapse forward.',
    'Sink as deep as your hips and ankles allow (aim for the thigh near or below parallel).',
    'Drive through the bent leg to return to the wide centre, then shift to the other side.',
    'Alternate sides each rep, or do all reps on one side then switch. Breathe in down, out up.',
  ],
  commonErrors: [
    { error: 'Not deep enough — barely bending', cameraDetection: 'Working-knee peak flex < MIN_REP_DEPTH (70°) fires incomplete-lunge (rep not counted)' },
    { error: 'Bending the straight (extended) leg too', cameraDetection: 'Extended-knee flex > 30° fires leg-not-straight; too-small working-vs-extended gap rejects the rep' },
    { error: 'No real weight shift — squatting in place', cameraDetection: 'Hip midpoint barely shifts over the working leg → rep rejected (malformed-rep)' },
    { error: 'Working knee caving inward (valgus collapse)', cameraDetection: 'Working knee.x drift toward midline vs baseline knee width' },
    { error: 'Torso collapsing forward / sideways', cameraDetection: 'Shoulder–hip line past 55° from vertical fires trunk-forward' },
  ],
  breathing: 'Inhale as you sink down onto the bending leg → brace at the bottom → exhale as you push back to the wide centre.',
  modifications: {
    easier: ['Shallower depth', 'Hold a chair/door frame for balance', 'Lift the extended-leg toes up (heel down) for stability'],
    harder: ['Full depth, hips below knee', 'Heel of the bent leg stays flat throughout', 'Slow 3-second lowering, pause at the bottom'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 3,
  defaultRepsPerSet: 8,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute knee, hip, or groin (adductor) injury',
    'I have enough hip and ankle mobility to squat deep to one side without pain',
    'I have something nearby to hold if I lose balance in the deep position',
  ],

  engineModule: 'cossack-squat',

  images: {
    // Placeholder: reuse the squat illustration until a dedicated Cossack hero is drawn.
    hero: 'svg:squat-hero',
    steps: ['svg:squat-hero'],
  },
  videoUrl: 'https://youtu.be/iPZNB5GsOnM',
};
