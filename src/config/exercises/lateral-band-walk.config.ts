import type { ExerciseConfig } from './types';

export const lateralBandWalkConfig: ExerciseConfig = {
  id: 'lateral-band-walk',
  catalogCode: 'D-LBW',
  name: 'Lateral Band Walk',
  category: 'functional',
  equipment: ['Resistance Band'],
  primaryMuscles: ['Glute Medius', 'Hip Abductors'],
  secondaryMuscles: ['TFL', 'Glute Minimus', 'Core'],
  difficulty: 'Beginner',
  trackFields: ['Distance', 'Steps'],
  instructions: [
    'Place a resistance band around both ankles (or just above knees for less tension).',
    'Stand with feet hip-width apart, slight bend in knees, hands on hips.',
    'Keep your back straight and core braced throughout. Do NOT let your torso lean sideways.',
    'Step your right foot out to the right until feet are slightly wider than shoulder-width.',
    'Bring your left foot to follow — but DO NOT let feet touch. Maintain tension on the band.',
    'Continue stepping sideways for the prescribed number of steps, then return the other direction.',
  ],
  commonErrors: [
    { error: 'Lateral trunk lean during each step', cameraDetection: 'Shoulder-hip angle > 30° from vertical during STEPPING_OUT state' },
    { error: 'Waddling hip drop on step leg', cameraDetection: 'Stepping-side hip Y drops > 6% torsoHeight' },
    { error: 'Crossing feet (band tension lost)', cameraDetection: 'Ankle X-positions crossing at midline' },
    { error: 'Walking out of camera frame', cameraDetection: 'Hip X landmark near frame edge (< 0.08 or > 0.92)' },
    { error: 'Fully straightening knees between steps', cameraDetection: 'Knee angle > 165° between steps' },
  ],
  breathing: 'Breathe naturally throughout. Do not hold breath between steps.',
  modifications: {
    easier: ['Lighter band resistance', 'Reduce step width', 'No band (bodyweight only)'],
    harder: ['Heavier band', 'Squat position throughout (add hip flexion)', 'Speed up the cadence'],
  },
  guidanceModes: { imageText: true, videoAudio: true, cameraVision: 'full' },

  exerciseType: 'rep-based',
  isStrength: true,
  defaultSets: 3,
  defaultRepsPerSet: 20,   // 20 steps (10 each direction) per set
  defaultRestSec: 60,
  safetyChecks: [
    'I have no acute hip or knee pain',
    'I have a resistance band available',
    'I have enough lateral space (at least 2 metres) in front of the camera',
  ],

  engineModule: 'lateral-band-walk',
  images: {
    hero: 'svg:lateral-band-walk-hero',
    steps: ['svg:lateral-band-walk-start', 'svg:lateral-band-walk-step'],
  },
  videoUrl: undefined,
};
