import type { ExerciseConfig } from './types';

export const seatedForwardFoldConfig: ExerciseConfig = {
  id: 'seated-forward-fold',
  catalogCode: 'J29',
  name: 'Seated Forward Fold',
  category: 'mobility',
  equipment: ['None', 'Mat (optional)'],
  primaryMuscles: ['Hamstrings', 'Erector spinae (stretch)'],
  secondaryMuscles: ['Calves', 'Glutes', 'Lower back'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Fold depth', 'Form score'],
  instructions: [
    'Sit on the floor side-on to the camera, with both legs straight out in front of you.',
    'Sit up tall first — lengthen your spine, roll your shoulders down and back.',
    'Hinge FORWARD FROM THE HIPS, reaching your chest toward your legs (not just rounding your back).',
    'Reach your hands toward your shins, ankles, or feet — wherever you comfortably get to.',
    'Keep your legs active. A soft micro-bend in the knees is fine if your hamstrings are tight.',
    'Hold and breathe slowly. To finish, hinge back up with a long spine.',
  ],
  commonErrors: [
    { error: 'Not folding deep enough', cameraDetection: 'Torso fold angle stays below the hold threshold' },
    { error: 'Rounding from the upper back instead of hinging at the hips', cameraDetection: 'Shallow hip-hinge fold angle' },
    { error: 'Yanking forward / bouncing', cameraDetection: 'Jerky torso motion (smoothed out, never forced)' },
    { error: 'Sitting back up out of the fold', cameraDetection: 'Torso returns toward vertical — hold ends' },
  ],
  breathing: 'Breathe slowly and deeply. Exhale as you fold a little deeper; never bounce or force.',
  modifications: {
    easier: ['Bend the knees generously (relieves the hamstrings)', 'Loop a strap/towel around the feet and hold it', 'Sit on a folded blanket to tilt the pelvis forward'],
    harder: ['Straighten the legs fully', 'Reach past the feet', 'Draw the chest closer to the thighs with a long spine'],
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
    'I have no acute lower-back pain or disc injury aggravated by forward bending',
    'I have no hamstring tear or acute strain',
    'I can sit on the floor and hinge forward without sharp pain',
  ],

  engineModule: 'seated-forward-fold',

  images: {
    hero: 'svg:seated-forward-fold-hero',
    steps: ['svg:seated-forward-fold-hero', 'svg:seated-forward-fold-shallow'],
  },
  videoUrl: 'https://youtube.com/shorts/5njnlgYYdD4',
};
