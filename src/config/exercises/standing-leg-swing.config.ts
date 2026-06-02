import type { ExerciseConfig } from './types';

export const standingLegSwingConfig: ExerciseConfig = {
  id: 'standing-leg-swing',
  catalogCode: 'J21 — Lateral Leg Swing',
  name: 'Standing Leg Swing',
  category: 'mobility',
  equipment: ['None'],
  primaryMuscles: ['Hip abductors (Glute medius)', 'Hip adductors', 'Hip flexors'],
  secondaryMuscles: ['Core (stabilizer)', 'Glutes', 'Ankle stabilizers'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps (each side)', 'Swing range'],
  instructions: [
    'Stand tall facing the camera, feet about hip-width. Rest a hand on a wall or chair for balance.',
    'Keeping your torso upright and standing leg strong, swing one leg out to the side and back through a comfortable range.',
    'Let it be rhythmic and dynamic — swing OUT to the side, then back across, in a smooth pendulum.',
    'Swing the leg clearly out to the side each rep (aim for around 35–45°). Keep the swinging leg relatively straight.',
    'Do all your swings on one side, then switch — or alternate. Keep your hips facing forward.',
    'Breathe naturally and stay loose — this is a warm-up / mobility drill.',
  ],
  commonErrors: [
    { error: 'Barely swinging the leg (tiny range)', cameraDetection: 'Peak hip abduction < 22° fires low-leg-raise' },
    { error: 'Wild, uncontrolled flinging', cameraDetection: 'Very high ankle velocity / sub-200 ms swing triggers malformed-rep' },
    { error: 'Leaning the torso to throw the leg', cameraDetection: 'Shoulder-midpoint x drift is tracked and penalizes the form score' },
  ],
  breathing: 'Breathe naturally and rhythmically with the swing — this is a loosening drill, not a strength hold.',
  modifications: {
    easier: ['Hold a wall or chair for balance', 'Smaller swing range', 'Slower tempo'],
    harder: ['Bigger range of motion', 'Add a front-to-back swing on alternate sets', 'No hand support'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: false,
  defaultSets: 2,
  defaultRepsPerSet: 12,
  defaultRestSec: 30,
  safetyChecks: [
    'I have no acute hip, groin, or lower-back injury',
    'I can balance on one leg (or I have a wall/chair to hold)',
    'I have space to swing my leg freely without hitting anything',
  ],

  engineModule: 'standing-leg-swing',

  images: {
    // Placeholder: reuse the side-leg-raise illustration (same lateral movement).
    hero: 'svg:side-leg-raise-hero',
    steps: ['svg:side-leg-raise-hero', 'svg:side-leg-raise-up'],
  },
  videoUrl: 'https://youtube.com/shorts/wXg5B8BK64g',
};
