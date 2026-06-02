import type { ExerciseConfig } from './types';

export const standingForwardFoldConfig: ExerciseConfig = {
  id: 'standing-forward-fold',
  catalogCode: 'G15',
  name: 'Standing Forward Fold',
  category: 'yoga-standing',
  equipment: ['None'],
  primaryMuscles: ['Hamstrings', 'Erector spinae (stretch)'],
  secondaryMuscles: ['Calves', 'Glutes', 'Lower back'],
  difficulty: 'Beginner',
  trackFields: ['Hold duration', 'Fold depth', 'Form score'],
  instructions: [
    'Stand side-on to the camera so your whole body is in frame.',
    'Stand tall with your feet hip-width apart, a soft micro-bend in the knees.',
    'Hinge forward FROM THE HIPS — let your torso fold down toward your legs.',
    'Keep your legs straight (not locked). The stretch is in the hamstrings, not the knees.',
    'Let your head and arms hang heavy toward the floor. Relax your neck.',
    'Hold and breathe slowly. To finish, hinge back up with a long spine.',
  ],
  commonErrors: [
    { error: 'Not folding deep enough', cameraDetection: 'Torso fold angle stays below the hold threshold' },
    { error: 'Bending the knees instead of hinging', cameraDetection: 'Knee flexion angle rises past the straight-leg threshold' },
    { error: 'Rounding from the upper back, not the hips', cameraDetection: 'Hip hinge angle (shoulder→hip vs vertical) is shallow' },
    { error: 'Standing back up out of the fold', cameraDetection: 'Torso returns toward vertical — hold ends' },
  ],
  breathing: 'Breathe slowly and deeply. Exhale as you fold a little deeper; never bounce.',
  modifications: {
    easier: ['Bend the knees generously (relieves the hamstrings)', 'Rest hands on shins or a block', 'Half-fold with a flat back, hands on thighs'],
    harder: ['Straighten the legs fully', 'Reach palms flat to the floor', 'Clasp behind the calves and draw the chest closer'],
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
    'I have no acute lower-back pain or disc injury aggravated by forward bending',
    'I have no condition where lowering my head below my heart is unsafe (e.g. uncontrolled high blood pressure, glaucoma)',
    'I can hinge forward without dizziness',
  ],

  engineModule: 'standing-forward-fold',

  images: {
    hero: 'svg:standing-forward-fold-hero',
    steps: ['svg:standing-forward-fold-hero', 'svg:standing-forward-fold-shallow', 'svg:standing-forward-fold-knees-bent'],
  },
  videoUrl: 'https://youtube.com/shorts/gyFQJIiMS2s',
};
