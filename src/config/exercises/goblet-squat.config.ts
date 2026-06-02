import type { ExerciseConfig } from './types';

export const gobletSquatConfig: ExerciseConfig = {
  id: 'goblet-squat',
  catalogCode: 'D-GS',
  name: 'Goblet Squat',
  category: 'functional',
  equipment: ['Dumbbell', 'Kettlebell'],
  primaryMuscles: ['Quadriceps', 'Glutes'],
  secondaryMuscles: ['Hamstrings', 'Calves', 'Core', 'Upper Back'],
  difficulty: 'Beginner',
  trackFields: ['Sets', 'Reps', 'Depth', 'Elbow Spread'],
  instructions: [
    'Hold a dumbbell or kettlebell vertically at chest height with both hands cupped around the top.',
    'Stand with feet shoulder-width apart, toes turned out 15–20°. Elbows point outward — not down.',
    'Brace your core. Take a deep breath and begin to squat by pushing knees out over toes.',
    'Lower until your elbows touch (or nearly touch) the inside of your knees. Thighs parallel or below.',
    'Keep your chest tall and elbows spread throughout. The weight counterbalances you forward.',
    'Drive through your heels to stand. Squeeze glutes at the top.',
  ],
  commonErrors: [
    { error: 'Elbows collapsing inward', cameraDetection: 'elbowSpreadRatio < 0.70 for 8+ frames during squat' },
    { error: 'Not reaching parallel depth', cameraDetection: 'Peak hip-knee-ankle angle does not reach MIN_REP_DEPTH_DEG' },
    { error: 'Knee valgus (knees caving in)', cameraDetection: 'Lead knee X collapses toward midline > 20% vs baseline' },
    { error: 'Heels lifting off floor', cameraDetection: 'Heel landmark rising above ankle baseline' },
  ],
  breathing: 'Inhale before you descend → exhale as you drive back up through your heels.',
  modifications: {
    easier: ['Hold a lighter weight', 'Use a box or chair to limit depth', 'Bodyweight only to learn the pattern'],
    harder: ['Pause 3 seconds at the bottom', 'Add more weight', 'Elevate heels on plates for deeper range'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },
  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 10,
  defaultRestSec: 90,
  safetyChecks: [
    'I have no acute knee pain during squatting movements',
    'I can hold the weight safely at chest height without wrist or elbow discomfort',
    'I have enough ankle mobility to keep heels on the floor at parallel depth',
  ],
  engineModule: 'goblet-squat',
  images: {
    hero: 'svg:goblet-squat-hero',
    steps: ['svg:goblet-squat-start', 'svg:goblet-squat-bottom'],
  },
  videoUrl: undefined,
};
