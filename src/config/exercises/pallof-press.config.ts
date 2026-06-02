import type { ExerciseConfig } from './types';

export const pallofPressConfig: ExerciseConfig = {
  id: 'pallof-press',
  catalogCode: 'D-PP',
  name: 'Pallof Press',
  category: 'functional',
  equipment: ['Resistance Band', 'Cable Machine'],
  primaryMuscles: ['Core (Anti-rotation)', 'Obliques'],
  secondaryMuscles: ['Transverse Abdominis', 'Glutes', 'Hip Abductors'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Hold'],
  instructions: [
    'Attach a resistance band to a fixed point at chest height. Stand perpendicular to the anchor, feet shoulder-width.',
    'Hold both ends of the band at your chest with both hands. This is your starting position.',
    'Brace your core hard — imagine someone is about to push you sideways.',
    'Press your hands straight out from your chest until arms are fully extended. Do NOT let your torso rotate toward the anchor.',
    'Hold the extended position for 1–2 seconds. Resist the band\'s pull. Stay square.',
    'Slowly return hands to chest. That is one rep. Complete all reps on one side, then switch.',
  ],
  commonErrors: [
    { error: 'Torso rotating toward anchor during press', cameraDetection: 'Shoulder Y asymmetry > 8° from baseline' },
    { error: 'Holding breath and shrugging shoulders', cameraDetection: 'Shoulder elevation > 6% torsoHeight' },
    { error: 'Incomplete extension (elbows not fully extended)', cameraDetection: 'Elbow angle < 145° at "full" press' },
    { error: 'Hold too brief (not resisting long enough)', cameraDetection: 'accumulatedValidHoldMs < 1000ms' },
  ],
  breathing: 'Exhale on the press out → hold breath lightly at extension → inhale on return.',
  modifications: {
    easier: ['Lighter band resistance', 'Reduce hold time', 'Kneeling Pallof press'],
    harder: ['Heavier band', 'Longer hold (3–5s)', 'Single-leg Pallof press'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },

  exerciseType: 'hold-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute lower-back or core injury',
    'I have access to a resistance band or cable machine',
    'I can maintain neutral spine while standing under light lateral load',
  ],

  engineModule: 'pallof-press',
  images: {
    hero: 'svg:pallof-press-hero',
    steps: ['svg:pallof-press-start', 'svg:pallof-press-extended'],
  },
  videoUrl: undefined,
};
