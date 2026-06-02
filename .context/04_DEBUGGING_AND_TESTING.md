# 04 — Debugging and Testing

Two tools are already wired into kriya-mirror. **Use them — don't bypass them**:

1. **Browser console logs** (`src/lib/debug.ts`) — every engine event is one line, easy to copy-paste
2. **Automated scenario pipeline** (`tests/`) — 34 scenarios pass in ~1 second, runs the real engines without a camera

Full workflow + lookup table lives in **`kriya-mirror/DEBUGGING.md`** at the project root. Read that for details. This file is the short version.

---

## Browser console workflow (when a bug shows up in real-world testing)

1. Open Chrome / Edge → F12 → Console tab
2. (Optional) Set verbose: `localStorage.KRIYA_DEBUG_LEVEL = 'verbose'` → reload
3. Reproduce the bug
4. Right-click console → "Save As" or select-all → copy
5. Paste to Claude with one sentence: *"I did a squat and rep 3 didn't count. Logs:"*

Claude can usually find the bug in one pass. Example output:
```
[KriyaMirror][SQUAT][STATE] STANDING → DESCENDING (t=4231ms)
[KriyaMirror][SQUAT][STATE] DESCENDING → AT_BOTTOM (t=5012ms)
[KriyaMirror][SQUAT][STATE] AT_BOTTOM → ASCENDING (t=5800ms)
[KriyaMirror][SQUAT][REJECT] Rep discarded | {reason: 'too-shallow', peakDepth: 42.3} (t=6520ms)
```
→ depth came in 2.7° below MIN_REP_DEPTH=45 → either tune the threshold or fix the pose interpretation.

---

## Automated scenario pipeline

```powershell
npm run test:scenarios         # all 34 scenarios, ~1 second
npm run test:scenarios:watch   # auto-rerun on save
npm run test:squat             # squat only
npm run test:plank             # plank only
```

### Folder layout

```
tests/
├── harness/
│   ├── types.ts           # IDX (landmark indices), SquatPoseIntent, PlankPoseIntent
│   ├── pose-stub.ts       # buildSquatPose / buildPlankPose from clinical intent
│   ├── frame-stream.ts    # buildFrames((tMs) → intent, builder, { fps, durationMs })
│   └── runner.ts          # runSquatSession / runPlankSession — drives the REAL engines
└── scenarios/
    ├── squat/   (6 files, 24 scenarios + 1 skipped)
    └── plank/   (4 files, 13 scenarios)
```

### The harness IS the productivity multiplier

The runner instantiates the **real** engine classes from `src/modules/`. No mocks, no replicas. So scenario tests catch real bugs:

- Engine bug #1 (bilateral `&&` accepting unilateral reps) — caught by `02-rep-validation.test.ts` `rejects unilateral reps`
- Engine bug #2 (plank spine-deviation 180° false alarm) — caught by `01-happy-path.test.ts` `holds for 30s with no warnings`

Two real production bugs surfaced before any camera was turned on.

### When adding a new exercise

Add scenarios under `tests/scenarios/<id>/` BEFORE manual browser testing. Minimum suite (covered in `02_EXERCISE_CHECKLIST.md` Step 8):
1. `01-happy-path.test.ts`
2. `02-rep-validation.test.ts` (rep-based only)
3. `03-posture-warnings.test.ts`
4. `04-calibration.test.ts`
5. `05-robustness.test.ts`

If your exercise needs a new pose-builder, add it to `tests/harness/pose-stub.ts` next to `buildSquatPose` / `buildPlankPose`. Key constraint: the synthesized pose must produce the desired engine-readable angle. See `buildSquatPose`'s isoceles-triangle `legGeometry()` for the worked example — collinear landmarks always read as 0° flexion, so you must offset joints perpendicularly.

### When a real-world bug is reported

After fixing the engine, **add a regression scenario** that would have failed pre-fix. This is non-negotiable — it's the only way the test suite stays trustworthy as the catalog grows.

Template at the bottom of `kriya-mirror/DEBUGGING.md`.

---

## Quick lookup — symptom → file to inspect

| Symptom | Likely file |
|---|---|
| Rep doesn't count after a clean squat | `src/modules/squat/engine.ts` → `validateRepShape()` |
| Warning never fires | per-warning detector in `src/modules/<engine>/engine.ts` |
| Calibration won't pass | `src/modules/<engine>/calibration.ts` → `checkGates()` |
| Plank ends immediately | `HOLD_BROKEN_SHOULDER_RISE` in `src/modules/plank/engine.ts` |
| Catalog mode chip wrong | `guidanceModes` in `src/config/exercises/<id>.config.ts` |
| SVG body line missing | check `filterUnits="userSpaceOnUse"` is set and IDs use `useId()` |
| Colors look slightly off | grep for Tailwind defaults like `text-teal-300`, replace with `text-accent-teal` |

---

## Verbose mode reference

`localStorage.KRIYA_DEBUG_LEVEL` accepts:

| Value | What logs appear |
|---|---|
| `'quiet'` | only critical events: REP, REJECT, BROKEN, SCORE |
| (default) `'info'` | calibration milestones, reps, rejections, warnings, hold start/broken |
| `'verbose'` | adds per-frame STATE transitions and per-tick TICK samples |

Set in DevTools console then reload the page. Delete the key to go back to default.

---

## One-paragraph summary for fresh sessions

When a bug is reported with browser logs, **read the logs first** — they tell you exactly what the engine saw. The format is `[KriyaMirror][<ENGINE>][<CATEGORY>] message | data (t=Xms)`. Then `npm run test:scenarios` to confirm existing scenarios still pass. Fix the engine. Add a regression scenario under `tests/scenarios/<engine>/` that reproduces the bug. Re-run scenarios. Done.
