# 01 — Architecture

## Tech stack

- **Next.js 14.2** (App Router) + **TypeScript** strict + **Tailwind**
- **MediaPipe tasks-vision 0.10.32** — pose detection (33 landmarks per frame), loaded from CDN by default
- **Zustand 5** — workout state store (single source of truth across setup → play → report)
- **Vitest 4** — scenario test runner (real engines, no DOM needed)
- No backend, no database, no auth. Pure client-side. Camera feed never leaves the device.

## Folder structure

```
kriya-mirror/
├── src/
│   ├── app/
│   │   ├── page.tsx                     # Catalog (landing)
│   │   ├── layout.tsx
│   │   ├── globals.css                  # Design tokens (CSS vars)
│   │   └── [exerciseId]/
│   │       ├── page.tsx                 # Detail (3-mode tabs)
│   │       ├── setup/page.tsx           # Sets/reps OR duration form + safety + privacy
│   │       ├── play/page.tsx            # Camera + skeleton + HUD/HoldTimer + warnings (ENGINE DISPATCH)
│   │       └── report/page.tsx          # Per-set table OR hold gauge + warning bars
│   ├── components/
│   │   ├── CatalogCard.tsx              # Stripped-down: name + difficulty + muscles only
│   │   ├── CategorySection.tsx
│   │   ├── ModeTabs.tsx                 # 📸 / 🎬 / 📷 selector
│   │   ├── ImageTextMode.tsx            # Renders instructions + SVG illustrations + common-errors
│   │   ├── VideoAudioMode.tsx           # YouTube iframe (auto-detects youtube.com/shorts/...)
│   │   ├── CameraVisionGateway.tsx      # CTA → /<id>/setup
│   │   ├── HUD.tsx                      # Rep-based: Set X/Y · Rep N/M · MQS · depth bar (mobile-responsive)
│   │   ├── HoldTimer.tsx                # Hold-based: 96px countdown + form bar
│   │   ├── PostureWarningChip.tsx       # Single chip, severity-aware, large readable text
│   │   ├── RestCountdown.tsx            # Between-set screen
│   │   ├── AudioToggle.tsx              # 🔊 / 🗣 mute toggles, localStorage-persisted
│   │   ├── PrivacyBadge.tsx             # Compact (landing) + Full (setup) variants
│   │   ├── SquatSvg.tsx                 # Stickman: stand / descend / hero (parallel)
│   │   └── PlankSvg.tsx                 # Stickman: hero (straight) / sag / pike
│   ├── config/
│   │   └── exercises/
│   │       ├── types.ts                 # ExerciseConfig + discriminator (rep-based | hold-based)
│   │       ├── index.ts                 # ALL_EXERCISES = [squat, plank]  — add new ones here
│   │       ├── squat.config.ts
│   │       └── plank.config.ts
│   ├── modules/
│   │   ├── engine-interface.ts          # Shared ExerciseEngine type — every engine implements this
│   │   ├── pose/                        # MediaPipe pose engine + types
│   │   ├── camera/                      # Camera manager + canvas sync
│   │   ├── squat/
│   │   │   ├── types.ts                 # FrameMetrics, CalibrationUpdate, callback types
│   │   │   ├── geometry.ts              # LM indices, kneeFlexionDeg, trunkLeanDeg
│   │   │   ├── calibration.ts           # 4-gate hold (body / feet wide / arms overhead / distance)
│   │   │   ├── scoring.ts               # MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
│   │   │   └── engine.ts                # State machine: STANDING → DESCENDING → AT_BOTTOM → ASCENDING + 7 warnings
│   │   └── plank/
│   │       ├── types.ts
│   │       ├── calibration.ts           # 4-gate side-profile (side / horizontal / forearms / distance)
│   │       ├── scoring.ts               # Completion × 0.40 + Form × 0.60
│   │       └── engine.ts                # No state machine — continuous form tracking + hip-sag/pike/spine/neck/broken
│   ├── lib/
│   │   ├── debug.ts                     # debugLog() — 3 levels, category-tagged
│   │   ├── audio/
│   │   │   ├── cues.ts                  # Web Audio: beep tones, no-overlap cooldown
│   │   │   ├── voice.ts                 # SpeechSynthesis: non-preemptive FIFO queue
│   │   │   └── preferences.ts           # useAudioPreferences() hook + module-level mirror
│   │   └── mediapipe/                   # Pose-detector + use-camera + use-pose hooks
│   ├── store/
│   │   └── workout.ts                   # Zustand: exercise, setup, sets[], holdRecord, status, actions
│   └── ...
├── tests/
│   ├── harness/
│   │   ├── types.ts                     # IDX (landmark indices), SquatPoseIntent, PlankPoseIntent
│   │   ├── pose-stub.ts                 # buildSquatPose / buildPlankPose from clinical intent
│   │   ├── frame-stream.ts              # buildFrames((tMs) → intent, builder, { fps, durationMs })
│   │   └── runner.ts                    # runSquatSession / runPlankSession — drives real engines
│   └── scenarios/
│       ├── squat/                       # 6 files, 24 scenarios (+1 skipped)
│       └── plank/                       # 4 files, 13 scenarios
└── public/
    ├── mediapipe/                       # Downloaded WASM + pose model (prebuild script)
    └── exercises/squat/                 # PNG/JPG images (squat uses copied images from mobility_new)
```

---

## The two big abstractions

### 1. `ExerciseConfig` discriminated union (`src/config/exercises/types.ts`)

```ts
type ExerciseType = 'rep-based' | 'hold-based';

interface ExerciseConfig {
  id, name, category, difficulty, instructions, commonErrors, breathing, modifications,
  guidanceModes: { imageText, videoAudio, cameraVision: 'full' | 'partial' | 'none' },

  exerciseType: ExerciseType,             // ← discriminator

  // rep-based fields:
  isStrength, defaultSets, defaultRepsPerSet, defaultRestSec,

  // hold-based fields (optional):
  defaultHoldDurationSec, minHoldDurationSec,

  safetyChecks: string[],
  engineModule: 'squat' | 'plank' | null,   // ← drives play-page dispatch
  images: { hero, steps[] },                // SVG ids like 'svg:squat-hero' OR file paths
  videoUrl?: string,                        // YouTube link → 🎬 mode auto-enabled
}
```

Setup page branches on `exerciseType` (sets/reps vs duration). Report page branches the same way (per-set table vs hold-time gauge).

### 2. `ExerciseEngine` interface (`src/modules/engine-interface.ts`)

Every engine implements this so `play/page.tsx` is engine-agnostic:

```ts
interface ExerciseEngine {
  update(landmarks: PoseLandmarks | null, now: number): void;
  finish(): void;
  resetForNextSet(): void;       // hold-based engines no-op this
}

interface ExerciseEngineCallbacks {
  onCalibrationUpdate?(update);
  onRepComplete?(rep);            // rep-based fires this
  onHoldTick?(tick);              // hold-based fires this (1Hz)
  onHoldBroken?();                // hold-based when user collapses
  onPostureWarning?(type);
  onFrame?(metrics);
}
```

Play page dispatch (in `play/page.tsx`):
```ts
if (exercise.engineModule === 'plank') {
  engineRef.current = new PlankEngine({ ...callbacks });
} else {
  engineRef.current = new SquatEngine({ ...callbacks });
}
```

When you add a new engine: import it, add another branch.

---

## Zustand store (`src/store/workout.ts`)

State shape:
- `exercise: ExerciseConfig | null`
- `setup: { plannedSets?, plannedRepsPerSet?, restSec?, weightKg?, holdDurationSec? }`  (all optional — populated by exerciseType)
- `status: 'idle' | 'setup' | 'tracking' | 'resting' | 'complete'`
- `sets: SetRecord[]` (rep-based)
- `holdRecord: HoldRecord | null` (hold-based)
- `currentSetIndex`, `restEndsAt`, `workoutStartedAt`, `workoutEndedAt`

Actions: `initWorkout`, `recordRep`, `completeSet`, `startRest`, `skipRest`, `beginNextSet`, `recordHoldTick`, `completeHold`, `finishWorkout`, `reset`.

`WarningType` union has 14 members covering both squat (heel-lift, valgus, trunk-forward, feet-narrow, malformed-rep, not-moving, etc.) and plank (hip-sag, hip-pike, spine-misaligned, neck-droop, hold-broken) plus shared (not-facing, too-close, too-far).

---

## The 5-screen flow

1. **`/`** (catalog) — categories grouped, cards per exercise (stripped to name/difficulty/muscles only)
2. **`/<id>`** (detail) — 3-mode tabs
3. **`/<id>/setup`** (only when 📷 selected) — form + safety + privacy
4. **`/<id>/play`** (workout) — camera + skeleton + HUD/HoldTimer + chips + rest screen
5. **`/<id>/report`** — accuracy gauge + breakdown

---

## Critical files (when changing things)

| Goal | Touch this |
|---|---|
| Add a new exercise to the catalog | `src/config/exercises/<id>.config.ts` + `index.ts` + engine routing in `src/app/[exerciseId]/play/page.tsx` |
| Change a warning string | `src/components/PostureWarningChip.tsx` |
| Change a warning voice line | `WARNING_SPEECH` in `src/app/[exerciseId]/play/page.tsx` |
| Add a new WarningType | `WarningType` union + `emptyWarningCounts()` in `src/store/workout.ts`, then PostureWarningChip + play-page priority/speech |
| Tweak a scoring threshold | `src/modules/<engine>/engine.ts` constants at top (commented with source-file references) |
| Add a new design token | `tailwind.config.ts` + CSS variable in `src/app/globals.css` |
| Add a debug-log call | `import { debugLog } from '@/lib/debug';` then `debugLog('SQUAT', 'STATE', 'message', { data })` |

See [02_EXERCISE_CHECKLIST.md](./02_EXERCISE_CHECKLIST.md) for the full add-an-exercise workflow.
