import type { ExerciseConfig } from './types';

export const chairPoseConfig: ExerciseConfig = {
  id: 'chair-pose',
  catalogCode: 'G8 — Utkatasana',
  name: 'Chair Pose',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps', 'Glutes'],
  secondaryMuscles: ['Core', 'Calves', 'Erector spinae'],
  difficulty: 'Beginner',
  trackFields: ['Duration', 'Form score', 'Knee angle'],
  instructions: [
    'Stand side-on to the camera, feet hip-width apart.',
    'Bend your knees as if sitting back into an invisible chair.',
    'Lower until your thighs are close to parallel with the floor — knee angle around 90°.',
    'Keep your chest tall — do not lean forward more than a slight hinge.',
    'Press your weight back into your heels. Do not let the heels lift off.',
    'Reach your arms forward at shoulder height (or overhead) for balance.',
    'Hold the position. Breathe steadily — do not hold your breath.',
  ],
  commonErrors: [
    { error: 'Knees straightening up (losing the hold)', cameraDetection: 'Knee flexion angle rises above 130°' },
    { error: 'Torso leaning too far forward', cameraDetection: 'Shoulder-hip vector tilts > 30° from vertical' },
    { error: 'Heels lifting off the floor', cameraDetection: 'Ankle Y rises > 3% of body length above baseline' },
    { error: 'Standing fully back up (ending the hold)', cameraDetection: 'Shoulder Y rises > 12% of body length above baseline' },
  ],
  breathing: 'Inhale to lengthen the spine. Exhale to sink deeper. Do not hold your breath.',
  modifications: {
    easier: ['Partial chair (knees less bent, ~120°)', 'Hands on thighs for support', 'Back against a wall'],
    harder: ['Arms straight overhead', 'Heels together, toes apart (Fierce Pose variation)', 'Add a slow pulse'],
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
  defaultHoldDurationSec: 20,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I have no acute knee pain or recent knee injury',
    'I have no lower-back injury that prevents holding a partial squat',
    'I can stand and bend my knees without dizziness',
  ],

  engineModule: 'chair-pose',

  images: {
    hero: 'svg:chair-pose-hero',
    steps: ['svg:chair-pose-hero', 'svg:chair-pose-knees-straight', 'svg:chair-pose-forward-lean'],
  },
  videoUrl: 'https://youtube.com/shorts/_GIKyB_n1TA',
};
