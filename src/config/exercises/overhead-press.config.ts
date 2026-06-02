import type { ExerciseConfig } from './types';

export const overheadPressConfig: ExerciseConfig = {
  id: 'overhead-press',
  catalogCode: 'S2',
  name: 'Overhead Press',
  category: 'strength-compound',
  equipment: ['Barbell', 'Dumbbells', 'Resistance Band'],
  primaryMuscles: ['Anterior Deltoid', 'Medial Deltoid', 'Triceps'],
  secondaryMuscles: ['Upper Pectorals', 'Serratus Anterior', 'Core'],
  difficulty: 'Intermediate',
  trackFields: ['Sets', 'Reps', 'Load (kg)', 'Lockout Quality', 'Tempo'],
  instructions: [
    'Stand facing the camera. Feet shoulder-width apart, core braced.',
    'Hold the bar at upper chest / front rack — elbows forward, below wrist level.',
    'Press the bar directly overhead in a vertical path. Tuck your chin slightly as the bar passes.',
    'Fully lock out your elbows at the top — arms fully extended, bar over your heels.',
    'Lower under control back to the rack position at shoulder level.',
    'Keep your lower back neutral throughout — avoid arching to push through sticking points.',
  ],
  commonErrors: [
    { error: 'Incomplete lockout (elbows not fully extended at top)', cameraDetection: 'Peak elbow flex angle > 30° at lockout' },
    { error: 'Lower back hyperextension', cameraDetection: 'Hip X vs shoulder X horizontal offset > 0.06 during press' },
    { error: 'Bar path drifting forward or backward', cameraDetection: 'Wrist X drift from baseline > 0.04 during press' },
    { error: 'Pressing too fast / using momentum', cameraDetection: 'Peak wrist velocity > 3.5 normalized units/sec' },
    { error: 'Asymmetric press (one arm lagging)', cameraDetection: 'Bilateral arm extension symmetry ratio < 0.70' },
  ],
  breathing: 'Big breath in and brace before pressing → exhale forcefully at lockout.',
  modifications: {
    easier: ['Seated dumbbell press', 'Arnold press', 'Machine shoulder press', 'Resistance band press'],
    harder: ['Push press (leg drive)', 'Strict press from pins', 'Overhead press + hold', 'Single-arm dumbbell press'],
  },
  guidanceModes: {
    imageText: true,
    videoAudio: true,
    cameraVision: 'full',
  },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 8,
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute shoulder pain or recent rotator cuff injury',
    'I have no elbow or wrist issues that limit overhead range',
    'I understand how to brace my core and keep my lower back neutral',
  ],

  engineModule: 'overhead-press',

  images: {
    hero: 'svg:ohp-hero',
    steps: ['svg:ohp-rack', 'svg:ohp-press', 'svg:ohp-lockout'],
  },
  videoUrl: '',
};
