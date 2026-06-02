import type { ExerciseConfig } from './types';

export const mountainPoseConfig: ExerciseConfig = {
  id: 'mountain-pose',
  catalogCode: 'G1',
  name: 'Mountain Pose',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Postural muscles (core, back)', 'Calves', 'Quadriceps'],
  secondaryMuscles: ['Glutes', 'Foot intrinsics', 'Shoulders'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Sway score', 'Postural alignment'],
  instructions: [
    'Stand tall, facing the camera, with feet together (or close, hip-width apart). Weight evenly across both feet.',
    'Engage the muscles of your thighs. Tuck your tailbone slightly so the pelvis is neutral. Lengthen the entire spine.',
    'Reach BOTH arms up overhead toward the ceiling. Palms can face each other or come together in prayer overhead.',
    'Roll your shoulders back and down. Lift through the crown of your head. Gaze forward at a fixed point.',
    'Breathe deeply. Stand tall and strong like a mountain reaching upward. Hold the lift.',
  ],
  commonErrors: [
    { error: 'Arms dropping — wrists fall below shoulder line', cameraDetection: 'Wrist Y > shoulder Y + small margin for 6+ frames fires arms-not-overhead' },
    { error: 'Slumping shoulders or rounding upper back', cameraDetection: 'Shoulder midpoint X drifts from hip midpoint X by > 0.10 of shoulder width' },
    { error: 'Uneven weight — one shoulder higher than the other', cameraDetection: 'Shoulder L-R Y difference > 0.10 of shoulder width fires posture-not-aligned' },
    { error: 'Excessive body sway', cameraDetection: 'CoM displacement > 6° from baseline fires swaying' },
    { error: 'User walks away or sits down', cameraDetection: 'Shoulder Y rises > 15% above baseline → hold ends' },
  ],
  breathing: 'Breathe slowly and deeply through your nose. Inhale to lengthen, exhale to ground.',
  modifications: {
    easier: ['Stand with feet hip-width apart for more base stability', 'Place hands on your hips if shoulders fatigue', 'Hold for a shorter duration (15–20 s)'],
    harder: ['Eyes closed (vestibular challenge)', 'Tadasana with arms extended overhead (Urdhva Hastasana)', 'Hold for 60+ seconds focusing on breath'],
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
  defaultHoldDurationSec: 30,
  minHoldDurationSec: 5,
  safetyChecks: [
    'I can stand comfortably for at least 30 seconds without dizziness',
    'I have no acute lower-back or hip pain',
    'I have no balance disorder that puts me at fall risk',
  ],

  engineModule: 'mountain-pose',

  images: {
    hero: 'svg:mountain-pose-hero',
    steps: ['svg:mountain-pose-hero', 'svg:mountain-pose-tilted'],
  },
  videoUrl: 'https://youtube.com/shorts/E1xym-F_B84',
};
