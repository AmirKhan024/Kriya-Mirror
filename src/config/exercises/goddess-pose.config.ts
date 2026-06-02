import type { ExerciseConfig } from './types';

export const goddessPoseConfig: ExerciseConfig = {
  id: 'goddess-pose',
  catalogCode: 'G14 — Utkata Konasana',
  name: 'Goddess Pose',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Quadriceps', 'Adductors', 'Glutes'],
  secondaryMuscles: ['Calves', 'Shoulders', 'Upper back', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Knee depth', 'Cactus arm position', 'Form score'],
  instructions: [
    'Stand FACING the camera with your feet wide apart — about 2× shoulder-width.',
    'Turn both toes out roughly 45° — knees will track over the same line.',
    'Bend BOTH knees deeply, sinking down until your thighs are close to parallel with the floor (~90°).',
    'Keep your torso upright and tall — do not lean forward. Stack shoulders over hips.',
    'Raise both arms into a "cactus" or goalpost position — shoulders out to the sides at shoulder height, elbows bent ~90°, palms facing forward.',
    'Press your knees outward over your toes — do not let them cave inward.',
    'Hold the pose. Breathe steadily — do not hold your breath.',
  ],
  commonErrors: [
    { error: 'Knees caving inward (valgus collapse)', cameraDetection: 'Knee X-separation < 75% of ankle X-separation fires knees-caving' },
    { error: 'Not sinking deep enough (thighs not toward parallel)', cameraDetection: 'Mean knee flexion < 70° fires knee-too-straight' },
    { error: 'Sinking too deep (past goddess into a full squat)', cameraDetection: 'Mean knee flexion > 115° fires knee-too-deep' },
    { error: 'Elbows dropping below shoulders / arms collapsing out of cactus', cameraDetection: 'Elbow Y > shoulder Y + tolerance fires arms-dropped' },
    { error: 'Torso leaning forward over the legs', cameraDetection: 'Trunk lean > 20° from vertical fires torso-too-forward' },
    { error: 'Standing fully back up (ending the hold)', cameraDetection: 'Shoulder Y rises > 15% of body height above baseline → hold ends' },
  ],
  breathing: 'Inhale to lengthen the spine. Exhale to sink slightly deeper into the pose. Steady deep breaths — do not hold your breath.',
  modifications: {
    easier: ['Narrower stance (closer to 1.5× shoulder-width)', 'Less knee bend (~120°) until you build strength', 'Hands at heart in prayer position if shoulders fatigue'],
    harder: ['Hold longer (45–60 s)', 'Add slow pulses up and down', 'Bring palms together overhead between holds'],
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
    'I have no acute knee, hip, or ankle injury',
    'I have no shoulder injury that prevents holding arms at shoulder height',
    'I have no recent lower-back strain',
  ],

  engineModule: 'goddess-pose',

  images: {
    hero: 'svg:goddess-pose-hero',
    steps: ['svg:goddess-pose-hero', 'svg:goddess-pose-knees-caving', 'svg:goddess-pose-arms-dropped'],
  },
  videoUrl: 'https://youtube.com/shorts/-agMz0HFh50?si=JPSCKxcwKmvq4BD-',
};
