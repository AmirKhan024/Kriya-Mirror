import type { ExerciseConfig } from './types';

export const boatPoseConfig: ExerciseConfig = {
  id: 'boat-pose',
  catalogCode: 'I13 — Navasana',
  name: 'Boat Pose',
  category: 'bodyweight',
  equipment: ['None'],
  primaryMuscles: ['Rectus abdominis', 'Hip flexors', 'Deep core'],
  secondaryMuscles: ['Quadriceps', 'Erector spinae', 'Adductors'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Leg height', 'Chest lift', 'Form score'],
  instructions: [
    'Sit on the floor with your SIDE to the camera so your whole body is visible from the side.',
    'Bend your knees, lean your torso back, and balance on your sit bones — chest lifted, spine long.',
    'Lift your feet off the floor and extend your legs up into a "V" (knees bent is fine to start).',
    'Reach your arms forward, parallel to the floor, alongside your legs.',
    'Hold the V: keep BOTH the legs and the chest lifted — do not let the legs sag to the floor.',
    'Gaze forward and breathe steadily, bracing the abdominals.',
  ],
  commonErrors: [
    { error: 'Legs sagging toward the floor', cameraDetection: 'Leg angle from horizontal < 22° fires legs-dropped' },
    { error: 'Chest collapsing / rounding back', cameraDetection: 'Torso angle from horizontal < 28° fires chest-dropped' },
    { error: 'Coming out of the boat (lying / sitting flat)', cameraDetection: 'Both torso and legs flatten → hold ends' },
  ],
  breathing: 'Breathe steadily into the belly. Exhale to brace the abs and lift the V a little higher.',
  modifications: {
    easier: ['Keep the knees bent (half boat)', 'Hold the backs of the thighs with your hands', 'Lower the legs slightly / shorter holds'],
    harder: ['Straighten the legs fully (full boat)', 'Hold longer (30 s+)', 'Lower-and-lift between holds (boat ↔ low boat)'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'hold-based',
  isStrength: false,
  defaultSets: 0,
  defaultRepsPerSet: 0,
  defaultRestSec: 0,
  defaultHoldDurationSec: 15,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I have no acute lower-back, hip flexor, or tailbone injury',
    'I can sit and balance on my sit bones without pain',
    'I have a mat or padded surface under me',
  ],

  engineModule: 'boat-pose',

  images: {
    hero: 'svg:boat-pose-hero',
    steps: ['svg:boat-pose-hero'],
  },
  videoUrl: 'https://youtube.com/shorts/azAtdTgH3Ig',
};
