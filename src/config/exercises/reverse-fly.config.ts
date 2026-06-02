import type { ExerciseConfig } from './types';

export const reverseFlyConfig: ExerciseConfig = {
  id: 'reverse-fly',
  catalogCode: 'B-RF',
  name: 'Reverse Fly',
  category: 'strength-isolation',
  equipment: ['Dumbbells', 'Resistance Band'],
  primaryMuscles: ['Rear Deltoid'],
  secondaryMuscles: ['Rhomboids', 'Middle Trapezius', 'Posterior Rotator Cuff'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Load'],
  instructions: [
    'Stand with feet hip-width apart. Hold dumbbells or a band in both hands.',
    'Hinge forward at your hips until your torso is at about 45° to the floor. Keep your back flat.',
    'Let your arms hang straight down from your shoulders, palms facing each other.',
    'Keeping a soft bend in the elbows, raise both arms out to your sides until they are parallel to the floor.',
    'Squeeze your rear delts and upper back at the top. Hold for one count.',
    'Lower slowly under control over 3 counts back to the hanging start position.',
  ],
  commonErrors: [
    { error: 'Using momentum or swinging', cameraDetection: 'Arm velocity spike > 3.5 normalised units/s' },
    { error: 'Not reaching shoulder height', cameraDetection: 'Peak armLiftDeg < 50° at rep close' },
    { error: 'One arm raising significantly higher than other', cameraDetection: 'Bilateral ratio < 0.60 at rep close' },
    { error: 'Torso not bent forward (doing standing lateral raise instead)', cameraDetection: 'shoulderMidY < hipMidY + 0.03 at calibration' },
  ],
  breathing: 'Exhale as you raise your arms → inhale as you lower them.',
  modifications: {
    easier: ['Use lighter dumbbells or a thinner band', 'Reduce range to 45° arc', 'Do one arm at a time'],
    harder: ['Pause 2 seconds at the top', 'Add a slight supination (rotate thumbs up) at top', 'Use heavier load'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 12,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute shoulder impingement or rotator cuff pain',
    'I can maintain a flat back while bent forward — no disc or lower-back issues',
    'I am using a weight light enough to control through the full range of motion',
  ],
  engineModule: 'reverse-fly',
  images: {
    hero: 'svg:reverse-fly-hero',
    steps: ['svg:reverse-fly-start', 'svg:reverse-fly-top'],
  },
  videoUrl: undefined,
};
