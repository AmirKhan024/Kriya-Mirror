export type ExerciseCategory =
  | 'strength-compound'
  | 'strength-isolation'
  | 'bodyweight'
  | 'functional'
  | 'cardio'
  | 'hiit'
  | 'yoga-standing'
  | 'yin-yoga'
  | 'pilates'
  | 'mobility'
  | 'balance'
  | 'breathwork'
  | 'sport-specific'
  | 'calisthenics'
  | 'senior-rehab'
  | 'postnatal'
  | 'office-desk';

export type MediaPipeVerdict = 'full' | 'partial' | 'none';

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';

/** Discriminator: drives setup form, play HUD, and report layout. */
export type ExerciseType = 'rep-based' | 'hold-based';

export interface CommonError {
  error: string;
  cameraDetection: string;
}

export interface ExerciseConfig {
  id: string;
  catalogCode: string;
  name: string;
  category: ExerciseCategory;
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  difficulty: Difficulty;
  trackFields: string[];
  instructions: string[];
  commonErrors: CommonError[];
  breathing: string;
  modifications: { easier: string[]; harder: string[] };
  guidanceModes: {
    imageText: boolean;
    videoAudio: boolean;
    cameraVision: MediaPipeVerdict;
  };

  /** Movement-pattern type. Determines setup form, HUD, and report shape. */
  exerciseType: ExerciseType;

  // ─── rep-based fields (used when exerciseType === 'rep-based') ───
  isStrength: boolean;
  defaultSets: number;
  defaultRepsPerSet: number;
  defaultRestSec: number;

  // ─── hold-based fields (used when exerciseType === 'hold-based') ───
  defaultHoldDurationSec?: number;
  minHoldDurationSec?: number;

  safetyChecks: string[];

  engineModule: string | null;

  images: { hero: string; steps: string[] };
  videoUrl?: string;
  audioCuesUrl?: string;

  /** Soft-deprecate switch. When `false`, the exercise is hidden from the home
   *  catalog but its code, engine, and route stay intact (navigating directly to
   *  `/<id>` still works). Omitted/`true` = visible. Flip to `true` to restore. */
  isVisible?: boolean;
}

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  'strength-compound': 'Strength — Compound',
  'strength-isolation': 'Strength — Isolation',
  bodyweight: 'Bodyweight & Home',
  functional: 'Functional Training',
  cardio: 'Cardio & Conditioning',
  hiit: 'HIIT Protocols',
  'yoga-standing': 'Yoga — Standing & Flow',
  'yin-yoga': 'Yin Yoga',
  pilates: 'Pilates',
  mobility: 'Mobility & Flexibility',
  balance: 'Balance & Proprioception',
  breathwork: 'Breathwork & Recovery',
  'sport-specific': 'Sport-Specific',
  calisthenics: 'Calisthenics',
  'senior-rehab': 'Senior / Rehab',
  postnatal: 'Postnatal',
  'office-desk': 'Office / Desk',
};

export const ALL_CATEGORIES: ExerciseCategory[] = Object.keys(
  CATEGORY_LABELS,
) as ExerciseCategory[];
