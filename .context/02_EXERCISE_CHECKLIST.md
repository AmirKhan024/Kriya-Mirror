# 02 — Adding a New Exercise (12-step checklist)

Use Squat as the template for **rep-based** exercises (Push-Up, Lunge, Glute Bridge, Curl, etc.) and Plank for **hold-based** exercises (Wall Sit, Tree Pose, Warrior poses, Bridge holds, etc.).

Estimated time: **~2 hours** for a rep-based variant in the same posture family as squat. **~3 hours** if it introduces a new camera angle (side, supine, overhead) or new pose-stub geometry. Add 30 min for SVG illustration.

---

## Step 0 — Pre-flight (5 min)

Before writing code, answer in your head:

1. **Type?** rep-based or hold-based?
2. **Camera angle?** front (squat, lunge, jumping jack) or side (plank, push-up, hip hinge, deadlift)
3. **What landmarks matter?** Look at `src/modules/squat/geometry.ts` `LM = { ... }` — these are MediaPipe indices. Identify which 4–6 are critical.
4. **What angle/distance is the "rep" defined by?** For squat: knee flexion. For push-up: elbow flexion. For lateral lunge: hip lateral angle. Pick the primary metric.
5. **What posture errors should warn the user?** List 3–5 (e.g., for push-up: hip sag, hip pike, elbows flaring, head dropping).
6. **What MediaPipe verdict?** Check `kriya-mirror-fitness-library.md` — `full` (✅), `partial` (⚠️), or `none` (❌). The .md already classifies all 274.

---

## Step 1 — Identify the template

| Your exercise is… | Copy from |
|---|---|
| Rep-based, front-facing (lunge, jumping jack, jump squat) | `squat` |
| Rep-based, side-facing (push-up, hip hinge, RDL) | `squat` (but with a side-camera calibration variant) |
| Rep-based, supine (glute bridge, sit-up) | `squat` |
| Hold-based, prone (plank variations) | `plank` |
| Hold-based, standing (warrior, tree, chair pose) | `plank` (but with front-camera calibration) |
| Hold-based, supine (savasana, leg-up-the-wall) | `plank` |

---

## Step 2 — Create the exercise config

File: `src/config/exercises/<id>.config.ts`. Copy `squat.config.ts` or `plank.config.ts` as a starting point.

Required fields (every field documented in `src/config/exercises/types.ts`):
- `id, name, category, equipment, primaryMuscles, secondaryMuscles, difficulty`
- `instructions[]` — pulled verbatim from the .md spec
- `commonErrors[]` — pulled from the .md spec ("Common Errors" section)
- `breathing, modifications`
- `guidanceModes: { imageText: true, videoAudio: true|false, cameraVision: 'full'|'partial'|'none' }`
- `exerciseType: 'rep-based' | 'hold-based'`
- Either `(isStrength, defaultSets, defaultRepsPerSet, defaultRestSec)` or `(defaultHoldDurationSec, minHoldDurationSec)`
- `safetyChecks[]` — 2–4 contraindications
- `engineModule: '<id>'` — string the play page routes on
- `images: { hero: 'svg:<id>-hero', steps: [...] }` — SVG ids (see Step 9)
- `videoUrl: 'https://youtube.com/shorts/...'` if you have one

---

## Step 3 — Register the config

In `src/config/exercises/index.ts`:

```ts
import { yourExerciseConfig } from './<id>.config';
export { ..., yourExerciseConfig };
export const ALL_EXERCISES: ExerciseConfig[] = [squatConfig, plankConfig, yourExerciseConfig];
```

That's it for the catalog — the card will appear automatically in the right category section.

---

## Step 4 — Build the engine module

Folder: `src/modules/<id>/`. Files (mirror squat or plank structure):

- `types.ts` — copy from `squat/types.ts` or `plank/types.ts`. Define your `Baseline` interface (what's captured at calibration), `FrameMetrics` (per-frame engine output), and `EngineCallbacks` (the events you emit).
- `geometry.ts` — reuse `src/modules/squat/geometry.ts`'s `LM`, `lmVisible`, `midpoint`. Add any new helpers (e.g., `elbowFlexionDeg` for push-up).
- `calibration.ts` — 3–4 gates with 2-second hold. Match the squat / plank pattern: each gate returns a boolean, all must pass, hold 2s, capture baseline. **Always include a distance gate** (too-close / too-far) with hints — this is in the known-issues file as a recurring failure pattern.
- `scoring.ts` — pure scoring functions. For rep-based: `getCompletionScore(peakDeg)`, `getFormScore(counts)`, `getSmoothnessScore(velocities)`, `computeMQS({...})`. For hold-based: `getHoldCompletionScore(actualSec, targetSec)`, `getFinalMqs(completion, form)`.
- `engine.ts` — the state machine + per-frame logic. **Sprinkle `debugLog` at every state transition, rep complete, rejection, and warning emission.** Mirror the cooldown + debounce patterns from squat/plank.

**Key constants to bring forward** (from squat — adapt thresholds per exercise):
- `EMA_ALPHA_*` — smoothing (0.15 for joint angles, 0.20 for plank form)
- `WARNING_REPEAT_COOLDOWN_MS = 2500` — same warning can't fire more than once every 2.5s
- `NO_FORM_OK_FRAMES = 6` — sustain debounce for posture warnings
- `MIN_REP_DURATION_MS = 300` — rejects ballistic reps
- `NO_MOVEMENT_TIMEOUT_MS = 12000` — "start moving" prompt after 12s idle

---

## Step 5 — Wire engine routing

In `src/app/[exerciseId]/play/page.tsx`, find the engine instantiation block and add a branch:

```ts
if (exercise.engineModule === 'plank') {
  engineRef.current = new PlankEngine({ ...sharedCallbacks, onHoldTick, onHoldBroken, onFrame });
} else if (exercise.engineModule === 'pushup') {                    // ← NEW
  engineRef.current = new PushUpEngine({ ...sharedCallbacks, onRepComplete, onFrame });
} else {
  engineRef.current = new SquatEngine({ ...sharedCallbacks, onRepComplete, onFrame });
}
```

If hold-based, also branch the HUD vs HoldTimer render block.

---

## Step 6 — Add new WarningTypes (if needed)

If your exercise has unique posture errors not in the existing union (e.g., `elbow-flare` for push-up):

1. Add to `WarningType` union in `src/store/workout.ts`
2. Add a `0,` entry to `emptyWarningCounts()` in the same file
3. Add chip strings in `src/components/PostureWarningChip.tsx` (both `STRINGS` and `URGENT_OVERRIDE` maps)
4. Add voice line in `WARNING_SPEECH` in `src/app/[exerciseId]/play/page.tsx`
5. Add to `WARNING_PRIORITY` in the same play page (where it fits — safety high, distance hints low)

---

## Step 7 — Build the SVG illustration

File: `src/components/<Id>Svg.tsx`. **MUST follow this pattern** to avoid two known bugs:

```tsx
'use client';
import { useId } from 'react';

export function PushUpSvg({ variant = 'hero', className }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `pu-glow-${uid}`;       // unique IDs per instance (multi-instance bug fix)
  return (
    <svg viewBox="0 0 360 200">
      <defs>
        <filter
          id={glowId}
          filterUnits="userSpaceOnUse"    // ← MANDATORY — see known-issues file
          x="-20" y="-20" width="400" height="240"
        >
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Body as individual <line> elements (NOT polyline — see known-issues) */}
      <line x1={shX} y1={shY} x2={hipX} y2={hipY} stroke="#00E5CC" strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
      <line x1={hipX} y1={hipY} x2={ankleX} y2={ankleY} stroke="#00E5CC" strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
      {/* ...etc */}
    </svg>
  );
}
```

Then wire it into `src/components/ImageTextMode.tsx`'s `HeroIllustration` function:
```tsx
if (heroId.startsWith('svg:pushup')) return <PushUpSvg variant="hero" className="..." />;
```

And in `src/app/[exerciseId]/setup/page.tsx` hero rendering.

---

## Step 8 — Write scenario tests

Folder: `tests/scenarios/<id>/`. Copy a squat or plank scenario file as a template. **At minimum**:

1. `01-happy-path.test.ts` — perfect form, expect reps counted / hold completed
2. `02-rep-validation.test.ts` (rep-based) — shallow / ballistic / unilateral rejection
3. `03-posture-warnings.test.ts` — each posture warning fires when it should
4. `04-calibration.test.ts` — each gate failure
5. `05-robustness.test.ts` — frame-rate invariance, jitter tolerance, pose-loss recovery

If your exercise needs a new pose builder (e.g., `buildPushUpPose`), add it to `tests/harness/pose-stub.ts` following the `buildSquatPose` / `buildPlankPose` pattern (deterministic noise, occlusion support, isoceles-triangle geometry for joint angles).

---

## Step 9 — Run tests + typecheck

```powershell
npm run test:scenarios     # all scenarios — must be green
npx tsc --noEmit          # type errors — must be clean
```

If a scenario fails, **read the failure output carefully** — it's often pointing at a real engine bug (this is how we found the bilateral `&&` bug and the plank `180-bendDeg` bug). Don't just adjust the expected value.

---

## Step 10 — Browser smoke test

```powershell
npm run dev
```

Open http://localhost:3000 → click your new card → click 📷 Camera Vision → run through the workout end-to-end. Watch the console (DevTools F12) — every state transition + rep should log. If something's off, set `localStorage.KRIYA_DEBUG_LEVEL = 'verbose'` and reload for per-frame data.

---

## Step 11 — Update CLAUDE.md + PROMPT.md "Currently shipped" lists

Two files, one line each. So future sessions know the new exercise is done:
- `CLAUDE.md` — first line of the orientation
- `PROMPT.md` — `## Currently shipped` section

---

## Step 12 — Hand back to Amir

Tell him:
- What exercise was added + how to test it (one terminal command + URL)
- Any known limitations or thresholds he might want to tune
- Whether any new SVG / image assets are needed beyond the placeholder
- Scenario test count and pass rate

Done.
