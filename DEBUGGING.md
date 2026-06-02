# Debugging Kriya Mirror

This project has two debugging tools designed to make it easy to find and fix
real-world bugs without endless back-and-forth: **structured console logs** in
the browser, and an **automated scenario pipeline** that runs in seconds and
catches regressions without needing a camera.

Workflow:

```
real-world bug → copy console → paste to Claude Code → fix engine → add a scenario
                                                                    ↑
                                              future regressions blocked here
```

---

## 1 · Browser console logs

Every engine event is logged in a single line, easy to grep / copy-paste:

```
[KriyaMirror][SQUAT][CALIB] waiting → good | {"gates":{"fullBody":true,"feetWide":true,"arms":true,"dist":true},"distHint":null} (t=1820ms)
[KriyaMirror][SQUAT][CALIB] good → confirmed | {...} (t=3020ms)
[KriyaMirror][SQUAT][CALIB] CONFIRMED | {"feetVsShoulderRatio":1.25,"torsoHeight":0.18} (t=3020ms)
[KriyaMirror][SQUAT][STATE] STANDING → DESCENDING | {"flex":26.4} (t=4231ms)
[KriyaMirror][SQUAT][STATE] DESCENDING → AT_BOTTOM | {"peak":98.1} (t=5012ms)
[KriyaMirror][SQUAT][STATE] AT_BOTTOM → ASCENDING | {"peak":98.1} (t=5800ms)
[KriyaMirror][SQUAT][REP] Rep complete | {"depthDeg":98.1,"smoothness":85,"form":92,"mqs":89,"warnings":[]} (t=6520ms)
[KriyaMirror][SQUAT][WARN] heel-lift (t=12340ms)
[KriyaMirror][SQUAT][REJECT] Rep discarded | {"reason":"too-shallow","peakDepth":42.3,"durationMs":1100,"leftPeak":42.3,"rightPeak":42.1} (t=18900ms)
```

### Log levels

Default is `info`. Toggle in DevTools console:

```js
localStorage.KRIYA_DEBUG_LEVEL = 'verbose'   // adds per-frame STATE + hold TICK lines
localStorage.KRIYA_DEBUG_LEVEL = 'quiet'     // only critical events: REP, REJECT, BROKEN, SCORE
delete localStorage.KRIYA_DEBUG_LEVEL         // back to default 'info'
```

Then reload the page.

### Categories

| Tag         | Fires when                                   | Engine |
|-------------|----------------------------------------------|--------|
| `[CALIB]`   | calibration state change / confirm           | both   |
| `[STATE]`   | rep state machine transition (verbose-only)  | squat  |
| `[REP]`     | rep complete + counted                       | squat  |
| `[REJECT]`  | rep failed a validation gate                 | squat  |
| `[WARN]`    | posture warning emitted (any type)           | both   |
| `[HOLD]`    | hold started                                 | plank  |
| `[TICK]`    | 1Hz form sample during hold (verbose-only)   | plank  |
| `[BROKEN]`  | hold ended early (user collapsed / stood up) | plank  |

### Bug-report recipe

When you hit a bug in the browser, do this:

1. Open DevTools (F12) → Console tab
2. Optionally set `localStorage.KRIYA_DEBUG_LEVEL = 'verbose'` and reload to capture more detail
3. Reproduce the bug
4. Right-click the console → "Save As" or select all → copy
5. Paste to Claude Code with one sentence: *"I did a squat and rep 3 didn't count. Logs:"*

Claude can usually identify the failure mode in one pass from the logs alone — e.g., a `[REJECT]` line with `reason: "too-shallow"` and `peakDepth: 42.3` tells the whole story: the engine thinks you didn't go below 45° depth.

---

## 2 · Automated scenario pipeline

```bash
npm run test:scenarios        # run all 34 scenarios (squat + plank), ~1 second
npm run test:scenarios:watch  # auto-rerun on file changes
npm run test:squat            # only squat
npm run test:plank            # only plank
```

### What's in there

**Squat** (24 scenarios, 1 skipped):
- happy-path (perfect 10-rep and 5-rep sessions)
- rep validation (shallow / ballistic / unilateral / minimum-depth boundary)
- posture warnings (heel-lift, trunk-forward) with debounce checks
- calibration gates (each failure mode)
- frame-rate invariance (15 / 30 / 60 fps)
- landmark noise tolerance
- pose-loss recovery
- no-movement detection (12 s idle)

**Plank** (13 scenarios):
- happy-path 30 s hold
- hip-sag / hip-pike detection (with debounce)
- hold-broken when user stands up
- calibration gates (distance hints, occlusion)
- noise tolerance
- pose-loss survival
- form-score sensitivity to mixed clean / sag windows

### Adding a regression scenario when a bug is fixed

After Claude fixes a bug in an engine, the immediate next step should be:
add a scenario that reproduces the bug pre-fix and confirms the fix.

Template — create `tests/scenarios/squat/12-my-bug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';

describe('Squat — regression: <one-line bug description>', () => {
  it('<what was wrong>', () => {
    const frames = buildFrames(
      (tMs) => {
        // ... reproduce the broken scenario from the bug report ...
      },
      buildSquatPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runSquatSession(frames);
    // Assertion that would have failed before the fix:
    expect(result.completedReps.length).toBe(<expected>);
  });
});
```

### How the harness works

| File | Role |
|---|---|
| `tests/harness/types.ts` | shared types — MediaPipe landmark indices, `SquatPoseIntent`, `PlankPoseIntent` |
| `tests/harness/pose-stub.ts` | `buildSquatPose(intent)` / `buildPlankPose(intent)` — synthesize 33-element MediaPipe landmark arrays from clinical intent (knee flexion, hip delta, etc.) with optional gaussian noise + occlusion + deterministic seed |
| `tests/harness/frame-stream.ts` | `buildFrames(intentAt, poseBuilder, { fps, durationMs })` — generate a time-keyed sequence of frames from an intent function |
| `tests/harness/runner.ts` | `runSquatSession(frames)` / `runPlankSession(frames)` — drive the **real** `SquatEngine` / `PlankEngine` through a frame stream, capture every event |

Each scenario is a normal Vitest file. No special infrastructure — just `describe / it / expect` plus the harness functions above.

### Known TODO

- **Squat valgus warning** is currently `it.skip`ped. The pose-stub's "swing-knees-outward" isoceles geometry produces a `kneeWidth` that grows with squat depth, which conflicts with the engine's baseline (captured at calibration when knees are above ankles). Valgus testing needs a side-perspective pose model. (Real-world MediaPipe doesn't hit this because 3D-to-2D projection keeps knees near ankle-X.) See `tests/scenarios/squat/03-posture-warnings.test.ts`.

---

## 3 · Bug lookup table

| Bug you're seeing in browser | Likely cause | Where to look |
|---|---|---|
| Rep doesn't count after a clean-looking squat | `[REJECT]` log with `reason` field | `validateRepShape()` in `src/modules/squat/engine.ts` |
| Warning never fires for obvious bad form | `[WARN]` line missing in console | per-warning detector in `src/modules/squat/engine.ts` (e.g. `detectHeelLift`) |
| Calibration won't pass | `[CALIB]` line shows which gate is `false` | corresponding check in `src/modules/squat/calibration.ts` or `src/modules/plank/calibration.ts` |
| Plank ends immediately | `[BROKEN]` with `shoulderRise` value | `HOLD_BROKEN_SHOULDER_RISE` threshold in `src/modules/plank/engine.ts` |
| Hold timer not advancing | no `[TICK]` lines even in verbose | engine's `lastTickAt` or `holdStartAt` logic |
| Catalog mode chip never enables | `guidanceModes` in exercise config | `src/config/exercises/<id>.config.ts` |

---

## 4 · Tips

- All logs include a `(t=Xms)` suffix that's the `performance.now()` timestamp — useful for measuring time between events.
- The `runSquatSession` / `runPlankSession` runners return *every* engine event, not just the user-visible ones. Use `frameMetricsSamples` if you need per-frame state for advanced debugging.
- Scenarios run in well under a second total. Add them liberally — they're cheap insurance.
