import type { ExerciseConfig } from './types';

export const downwardDogConfig: ExerciseConfig = {
  id: 'downward-dog',
  catalogCode: 'G38',
  name: 'Downward Dog',
  category: 'yoga-standing',
  equipment: ['None', 'Mat (optional)'],
  primaryMuscles: ['Hamstrings', 'Calves', 'Shoulders'],
  secondaryMuscles: ['Lats', 'Erector spinae', 'Glutes'],
  difficulty: 'Intermediate',
  trackFields: ['Hold duration', 'Hip height (inverted V)', 'Form score'],
  instructions: [
    'Stand side-on to the camera so your whole body is in frame.',
    'Start on hands and knees, hands a little forward of your shoulders.',
    'Tuck your toes and lift your hips up and back into an inverted V.',
    'Press the floor away through your hands — straighten your arms and lengthen your spine.',
    'Lift your hips as high as you can; let your heels reach toward the floor.',
    'Hold and breathe steadily. To finish, lower back to hands and knees.',
  ],
  commonErrors: [
    { error: 'Hips dropping toward a flat / plank line', cameraDetection: 'Hip apex angle opens toward 180° (V flattening)' },
    { error: 'Not lifting the hips high enough', cameraDetection: 'Hip is not clearly the highest point of the body' },
    { error: 'Rounding the upper back instead of hinging', cameraDetection: 'Shallow inverted-V apex' },
    { error: 'Coming out of the pose (standing / dropping down)', cameraDetection: 'Inverted V fully collapses — hold ends' },
  ],
  breathing: 'Breathe slowly and evenly through the nose. Lengthen the spine on each inhale.',
  modifications: {
    easier: ['Bend the knees generously (relieves tight hamstrings)', 'Shorten the stance', 'Pedal the heels to warm up the calves'],
    harder: ['Straighten the legs and press the heels toward the floor', 'Hold longer', 'Three-legged dog (lift one leg)'],
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
    'I have no wrist injury that prevents bearing weight on my hands',
    'I have no shoulder injury aggravated by overhead weight-bearing',
    'I have no condition where lowering my head below my heart is unsafe (e.g. uncontrolled high blood pressure, glaucoma)',
  ],

  engineModule: 'downward-dog',

  images: {
    hero: 'svg:downward-dog-hero',
    steps: ['svg:downward-dog-hero', 'svg:downward-dog-sag'],
  },
  videoUrl: 'https://youtube.com/shorts/ILYV8GwnNYo',
};
