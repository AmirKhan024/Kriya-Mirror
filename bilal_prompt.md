# Kriya Mirror — Onboarding Prompt (for Bilal's Claude Code session)

> **⚠️ SUPERSEDED by [`new_session_prompt.md`](./new_session_prompt.md)** — that file is the canonical, reusable onboarding script (covers rounds 1–15, generic across future sessions). This file is kept only as historical reference for the rounds-1-to-8 snapshot. **Do NOT paste this file into a new session — use `new_session_prompt.md`.**
>
> **Paste this entire file into a fresh Claude Code session** opened at the unzipped `kriya-mirror` folder. The Claude reading this has never seen the project. By the end of this prompt it should know exactly what to read, what to build, what NOT to touch, and what quality bar to hit.
>
> **Note to Claude:** this file is a one-time onboarding script — once you've read it through, treat the `.context/*.md` and `HANDOFF_ROUND_4.md` files as the canonical project docs. Don't keep this `bilal_prompt.md` in your active reading rotation; only refer back to it if you forget the rules.

---

## 0. Who you are and what you're doing

You are Claude Code, working on behalf of **Bilal**. The project owner is **Amir** — he built the existing 7 exercises and is now delegating new-exercise work to Bilal. You will:

1. **Read the existing project context** (sources below) before touching anything.
2. **Pick ONE new exercise** that is NOT in the list of already-shipped exercises (§3).
3. **Implement it end-to-end** following every fix and policy that Amir's prior sessions established (§5).
4. **Ship it to the same quality bar** as the existing 7: TypeScript strict, all scenario tests green, physical test passed.
5. **Stop after one exercise.** Don't start a second one without explicit go-ahead from Bilal.

You will work inside `C:\Users\<bilal-user>\...\kriya-mirror\` (wherever Bilal unzipped the project). Treat that as your working directory throughout.

---

## 1. Ground rules (non-negotiable)

- **Do not touch the 7 existing exercise engines.** They are field-validated. Their files: `src/modules/{squat,plank,pushup,lunge,bicep-curl,tandem-stand,single-leg-stand}/*`.
- **Do not refactor shared components** (`src/store/workout.ts`, `src/app/[exerciseId]/report/page.tsx`, `src/app/[exerciseId]/play/page.tsx`, `src/app/[exerciseId]/setup/page.tsx`, `src/components/*`) beyond the targeted hook-ins listed in §6.
- **Do not bulk-edit.** One exercise. One PR-equivalent diff. One physical test.
- **Do not skip tests or use `--no-verify`.** If something fails, fix the root cause.
- **Do not add a new exercise category** if your pick fits an existing one.
- **Do not invent design patterns.** Mirror what squat (rep-based reference) or plank (hold-based reference) already does.

---

## 2. Boot sequence — read these BEFORE writing any code

In this exact order. Use the `Read` tool — do not skim.

1. **`CLAUDE.md`** at the repo root — Amir's standing instructions + hard rules. Auto-loads but verify you've absorbed it.
2. **`.context/00_START_HERE.md`** — project orientation.
3. **`.context/01_ARCHITECTURE.md`** — engine interface, store, exercise registry, routing.
4. **`.context/02_EXERCISE_CHECKLIST.md`** — the canonical step-by-step pipeline for adding any new exercise. **This is your bible.**
5. **`.context/03_KNOWN_ISSUES_TO_PREVENT.md`** — every footgun that caused a physical-test regression. Don't repeat them.
6. **`.context/04_DEBUGGING_AND_TESTING.md`** — how the test harness works, how to use `debugLog`, how `localStorage.KRIYA_DEBUG_LEVEL` works.
7. **`DEBUGGING.md`** at the repo root — the long-form debugging cookbook that `04_DEBUGGING_AND_TESTING.md` points you to. Skim it; you'll come back when you hit a real bug.
8. **`.context/05_DESIGN_RULES.md`** — UI rules (Rule A: one chip at a time; Rule B: audio no-cutoff; Rule C: readable from 2 m).
9. **`HANDOFF_ROUND_4.md`** at the repo root — the patterns Amir's rounds 1–5 established. **Read sections §2 (fixes A–E) and §3.1–§3.8 in full** — every one applies to your new engine. (Rounds 6–8 added more cross-cutting fixes — those are documented in §5 of this prompt below, not yet in HANDOFF.)
10. **`kriya-mirror-fitness-library.md`** — Bilal has this file separately (Amir is sharing it alongside the zip). It's NOT in the repo. It defines the master fitness library with per-exercise: equipment, muscles, MediaPipe tracking landmarks, instructions, common errors, breathing patterns, modifications. You pick from this list.
11. **`README.md`** at the repo root (if present) — boot commands.

Don't write code until you've read all eleven. If any file is missing, ask Bilal.

---

## 3. The 7 exercise IDs already taken — do NOT reuse

```
squat              (rep-based)
plank              (hold-based)
pushup             (rep-based)
lunge              (rep-based, unilateral)
bicep-curl         (rep-based, bilateral)
tandem-stand       (hold-based, balance)
single-leg-stand   (hold-based, balance)
```

Anything in `src/modules/<one-of-these>/` is OFF-LIMITS for editing. You will reference these as patterns to copy, but you will not modify their files.

---

## 4. How to pick your exercise

1. Read `kriya-mirror-fitness-library.md` (the one Bilal received separately).
2. Filter to exercises that are:
   - **Camera-vision trackable** — MediaPipe BlazePose gives you 33 landmarks. If the exercise needs landmarks BlazePose can't see (e.g. wrist rotation, finger position), skip it.
   - **Not already in §3.**
   - **Single-pose-mode** — pick "rep-based" (counted reps, like push-up) or "hold-based" (timed hold, like plank). Don't invent a third mode.
3. **Use `AskUserQuestion`** to confirm your pick with Bilal before starting. Show him 2–3 candidates with one-line reasons each. Let him choose.
4. Once chosen, lock the `id` (kebab-case, e.g. `mountain-climber`, `wall-sit`, `glute-bridge`) and tell Bilal. From here on, that ID propagates everywhere.

---

## 5. The fix list — apply every one of these to your engine

These came from Amir's physical-testing rounds. Each one was a real bug. Don't skip any.

| # | Name | Applies to | Reference |
|---|---|---|---|
| **A** | Warning-spam gating | rep + hold | rep: gate to `repState !== 'STANDING'`; hold: already gated by post-calibration `processHoldFrame()` |
| **B** | "Wrong gets discarded" | rep + hold | rep: `validateRepShape()` rejects bad reps; hold: `accumulatedValidMs` freezes timer during sustained bad form |
| **C** | `durationMs` reset-order | rep only | reset rep buffers BEFORE setting `repStartedAt = now` |
| **D** | Validation reject-reason order | rep only | unilateral check BEFORE too-shallow check (skip if your exercise is intentionally unilateral, like lunge) |
| **E** | `TIMER frozen/resumed` debug logs | hold only | `debugLog('<TAG>', 'TIMER', 'frozen' / 'resumed', { reason, accumulatedSec })` on freeze edges |
| **F** | Calibration distance-gate hysteresis | both (if applicable) | separate ENTER/EXIT thresholds so frame jitter doesn't flip the gate |
| **G** | Instant calibration | both | `CONFIRM_DURATION_MS = 200` (NOT 2000) — confirms ~instantly once gates green, with a 6-frame debounce |
| **H** | Distance hints | both | calibration emits `distanceHint: 'too-close' \| 'too-far' \| null` whenever body-length check fails |
| **I** | 5 s idle warning | rep only | `NO_MOVEMENT_TIMEOUT_MS = 5000`, repeats max every 15 s, initialized on calibration confirm |
| **J** | Retry on calibration timeout | both | engine sets `state: 'timeout'` after `TIMEOUT_MS`; play page handles UI |
| **K** | Glossary | both | use existing `GlossaryRepBased` / `GlossaryHoldBased` in report page — DON'T touch unless you add a brand-new user-facing metric |
| **L** | Mobile CSS | both (UI) | follow patterns in `HANDOFF_ROUND_4.md §3.2` — text-7xl→5xl on mobile, grid-cols-3→1 for forms, etc. |
| **M** | Chart axes | hold only (if you add a chart) | follow `FormTimeChart` convention — labelled x-axis (time, seconds) + y-axis + axis titles |
| **N** | `position-lost` engine wiring (round 6) | rep + hold | After cal-confirm, if no usable landmarks for ≥ 3 s, emit `'position-lost'`. Repeats every 10 s while lost. UI infra is complete — your engine just needs: constants `POSITION_LOST_TIMEOUT_MS = 3000` + `POSITION_LOST_REPEAT_MS = 10_000`; fields `lastValidFrameAt` + `lastPositionLostWarnAt`; helper `hasCoreLandmarks()`; method `checkPositionLost()`; and a call site at the TOP of `update()` BEFORE the existing landmark-null early-return. **Mirror `src/modules/lunge/engine.ts` L60-61, L107-108, L138, L149-154, L511-531 exactly** (or the bicep-curl equivalents). Add `17-position-lost.test.ts`. |
| **O** | Post-rep EMA-decay reseed (round 7) | rep only | After a rep returns to STANDING/EXTENDED, EMA-smoothed flexion decays exponentially from ~17° toward rest. Its tail permanently inflates `max - min`, so the `not-moving` variance gate (< 2°) never closes after a real rep. Fix: when per-frame `\|smoothedFlexion - prevSmoothedFlexion\| < 0.3°` holds for 500 ms, reseed `flexionMin/Max` from the current value AND reset `since = now`. Mirror lunge's `standingSettledSince` / `standingBaselineReseeded` (or bicep-curl's `extendedSettledSince` / `extendedBaselineReseeded`). Reset these flags in 4 sites: cal-confirm init, the LOWERING/ASCENDING → rest transition, after a `not-moving` fire, and the `repState !== <rest>` early-return in `checkNoMovement`. Add `14-not-moving-after-rep.test.ts`. |
| **P** | Cold-start cooldown sentinel | rep only | `firstFireAllowed = this.lastNoMovementWarnAt === 0 \|\| now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;`. Without this, the initial 0 value blocks the FIRST `not-moving` warning whenever the engine `now` is still small (notably in the test harness where `now` starts near 0). Apply alongside Fix I. |
| **Q** | Calibration overlay text branch | both | `src/app/[exerciseId]/play/page.tsx` ~L530-590 has a switch over `exercise?.engineModule`. Without your branch the user sees squat's misleading "Stand facing the camera, feet wide, arms overhead" copy. Add a branch in (1) the title block AND (2) each of the 3 CheckRow labels (`fullBodyVisible` / `feetWide` / `armsOverhead` — remap to your exercise's actual gate semantics, e.g. "Arms relaxed at sides" for a curl, "Side profile in frame" for a side-view exercise). |
| **R** | Ballistic-velocity threshold is exercise-specific | rep only | Don't blindly copy squat's `MAX_HIP_VELOCITY = 1.5`. The threshold depends on WHICH landmark you track (hip / shoulder / wrist) and how far it travels per rep. Reference values after physical testing: squat & lunge hip = **1.5**, push-up shoulder = **3.0**, bicep curl wrist = **4.0**. Pick the closest analog, then EXPECT to tune it during physical test if normal-paced reps are getting rejected as "ballistic". Single-frame MediaPipe jitter peaks scale with the landmark's arc length. |

**Read `HANDOFF_ROUND_4.md` for the exact code patterns.** Don't paraphrase — copy the structure.

> **About the F–R letter convention**: `HANDOFF_ROUND_4.md` literally only defines Fixes **A–E** in its §2. The F–M letters are pedagogical groupings of cross-cutting POLICIES from HANDOFF §3.x — if you `grep "Fix G"` in HANDOFF you won't find it. The mapping: **F**→§3.4, **G**→§3.5, **H**→§3.6, **I**→§3.7, **J**→§3.8, **K**→§3.3 (glossaries), **L**→§3.2 (mobile CSS), **M**→§3.1 (charts). Letters **N–R** are from rounds 6–8 and are documented only in this prompt (see the reference engines for the actual code).

---

## 6. Code recipe — files you will create or extend

### New files (in your exercise's own folder — safe to create):

```
src/config/exercises/<id>.config.ts          # exercise metadata + defaults
src/modules/<id>/engine.ts                   # your ExerciseEngine implementation
src/modules/<id>/calibration.ts              # gates, distance hint, hysteresis
src/modules/<id>/scoring.ts                  # MQS formula (mirror plank/squat)
src/modules/<id>/types.ts                    # local interfaces
tests/scenarios/<id>/01-happy-path.test.ts
tests/scenarios/<id>/02-validation.test.ts   # (rep) or 02-deviations (hold)
tests/scenarios/<id>/03-posture-warnings.test.ts
tests/scenarios/<id>/04-calibration.test.ts
tests/scenarios/<id>/05-<discard-or-gating>.test.ts
tests/scenarios/<id>/06-distance-gate-hysteresis.test.ts   # if your dist check is noisy

# Rep-based only (rounds 5-7 regressions — REQUIRED for rep engines):
tests/scenarios/<id>/13-not-moving-init.test.ts                  # Fix I + Fix P
tests/scenarios/<id>/14-not-moving-after-rep.test.ts             # Fix O
tests/scenarios/<id>/15-warning-gating-during-<idle-state>.test.ts  # Fix A

# Rep + hold (round 6 regression — REQUIRED for every engine):
tests/scenarios/<id>/17-position-lost.test.ts                    # Fix N
```

### Files you will EXTEND (precise hook-ins only):

| File | What you add |
|---|---|
| `src/config/exercises/index.ts` | One line: `import myConfig from './<id>.config'` + push into `ALL_EXERCISES` |
| `src/store/workout.ts` | New entries in the `WarningType` union (any new warnings unique to your engine) + matching entries in `emptyWarningCounts()` |
| `src/app/[exerciseId]/play/page.tsx` | One branch in the engine-routing switch (~line 304-349), one entry per new warning in `WARNING_SPEECH` (~line 89-115) |
| `src/app/[exerciseId]/report/page.tsx` | One entry per new warning in `WARNING_LABEL` (~line 8-34) and matching `newWarningTotals()` key (bottom of file) |
| `tests/harness/types.ts` | `<Id>PoseIntent` type — the inputs your test scenarios pass to the pose synthesizer |
| `tests/harness/pose-stub.ts` | `build<Id>Pose(intent)` — synthesizes a 33-landmark array from intent fields |
| `tests/harness/runner.ts` | `run<Id>Session(frames)` — runs your engine through a frame stream and captures all events |
| `src/components/ImageTextMode.tsx` | ONLY if your exercise needs custom on-screen instruction copy/diagrams. There's a per-`exercise.id` switch (~L70 area) — add a branch for your id. Otherwise the generic copy works fine; leave the file alone. |

**Do not edit anything else in those shared files.** If you think you need to, stop and ask Bilal.

> **Video URL** — most existing exercise configs have a `videoUrls.youtube` short-link field. You can leave it as `null` for the initial ship; Amir/Bilal will add a real link later (he sources them manually from YouTube Shorts).

---

## 6.5 Baseline-shape adaptation (only if your calibration needs different fields than squat)

The shared `CalibrationUpdate.baseline` field is typed as **squat's** `CalibrationBaseline` shape (hipMid, shoulderMid, hipWidth, shoulderWidth, torsoHeight, ankleY, feetWidth, feetVsShoulderRatio, leftKneeX, rightKneeX). The play page reads this shape uniformly across all engines.

If your engine's calibration captures different fields (e.g. lunge cares about `leftKneeX`/`rightKneeX` already, bicep curl needed `leftElbowX`/`rightElbowX`/`shoulderMidX`):

1. Define a local `<Id>Baseline` interface in `src/modules/<id>/types.ts` with whatever fields YOUR engine actually needs.
2. Inside the engine, capture into the local shape: `private baseline: <Id>Baseline | null = null`.
3. In `calibration.ts`, write an adapter `function toSquatBaseline(b: <Id>Baseline): CalibrationBaseline` that populates ONLY the squat fields the play page reads (others can default to 0 or be computed from your local fields).
4. The `CalibrationUpdate.baseline` returned to the play page uses the adapted shape.

**Reference**: `src/modules/lunge/calibration.ts` `toSquatBaseline()` (~L217-230) and `src/modules/bicep-curl/calibration.ts` for examples.

---

## 7. The test rigor expected

Mirror what shipped for squat (rep-based), plank (hold-based), lunge, and bicep-curl. Read `tests/scenarios/squat/01-happy-path.test.ts` and `tests/scenarios/plank/01-happy-path.test.ts` as templates. Read `tests/scenarios/lunge/14-not-moving-after-rep.test.ts` and `tests/scenarios/lunge/17-position-lost.test.ts` for the round 6/7 regression templates.

Minimum per engine (count = ~20-25 new tests across 8-9 files):

**Always required (rep + hold):**
- **01-happy-path** — clean execution → engine produces expected number of reps OR a clean hold tick at the target time
- **02-validation** (rep) or **02-deviations** (hold) — bad form is correctly detected
- **03-posture-warnings** — each warning fires when it should + debounce works (brief flickers don't trigger)
- **04-calibration** — gates pass/fail correctly, `distanceHint` populates, instant confirm works (~200 ms)
- **05-warning-gating-during-<idle-state>** (rep) or **05-discard-bad-form-time** (hold) — the "wrong gets discarded" mechanic
- **17-position-lost** — Fix N regression (null landmarks for 4 s → fires; clean stream → silent; respects 10 s cooldown)

**Only if your distance check is noisy:**
- **06-distance-gate-hysteresis** — copy `tests/scenarios/plank/06-distance-gate-hysteresis.test.ts`

**Rep-based only (round 5-7 regressions, ALL required):**
- **13-not-moving-init** — Fix I + Fix P: cal-confirm seeds idle tracker; cold-start cooldown allows first fire after 5 s of idle
- **14-not-moving-after-rep** — Fix O: do a real rep, then idle for 8 s, assert `not-moving` fires (this catches the EMA-decay-tail bug)
- **15-warning-gating-during-<idle-state>** — Fix A: posture warnings stay silent while user is resting between reps

For hold-based, also add tests for `hold-broken` detection if your exercise has a structural-failure mode.

---

## 8. Per-step process — the loop

Follow this order. Each step is a checkpoint — don't move on until it's clean.

1. **Confirm exercise pick.** `AskUserQuestion` with 2-3 candidates → Bilal chooses → lock ID.
2. **Add config + register.** Just enough that `/<id>/setup` renders the setup form. `npm run dev` and verify the page loads.
3. **Stub calibration + engine.** Implement `update()` and `finish()` as no-ops. Page should boot to camera but show "waiting" forever.
4. **Implement calibration gates.** Including hysteresis (F), instant confirm (G), distance hints (H), timeout (J).
5. **Write `04-calibration.test.ts`.** Run scenarios — should be green.
6. **Implement engine state machine.** Rep-based: STANDING / DESCENDING / AT_BOTTOM / ASCENDING (or analog). Hold-based: just `processHoldFrame()` with `accumulatedValidMs`.
7. **Add per-frame warning emission.** With Fix A gating, Fix C reset-order (rep), Fix D validation order (rep), Fix E TIMER logs (hold).
8. **Add idle detection (Fix I, rep only).** Initialize the idle counter on calibration confirm — `13-not-moving-init.test.ts` in squat shows the regression.
9. **Implement scoring.** Mirror `plank/scoring.ts` or `squat/scoring.ts`.
10. **Write all `01-05` scenario tests.** Each one passes before moving on.
11. **Wire play page route + warning text + report label.** Targeted edits per §6.
12. **`npx tsc --noEmit`** — clean.
13. **`npm run test:scenarios`** — all green (current baseline: **161** + your ~20-25 = ~181-186).
14. **`npm run dev`** + Bilal physical-tests. Open `/<id>/setup`, do the workout, paste console logs.
15. **Iterate on physical-test feedback.** Don't say "done" until Bilal confirms.

---

## 9. Quality gates (non-negotiable)

- ✅ TypeScript strict — no `any`, no `@ts-ignore`, no `unknown` casts you don't understand
- ✅ Every scenario test passes — no `.skip`, no `xfail`, no commented-out assertions
- ✅ No `console.log` in committed code — use `debugLog(engineTag, category, message, data)` from `src/lib/debug.ts`
- ✅ No commented-out code blocks left behind
- ✅ No new npm dependencies without asking Bilal first
- ✅ No new global CSS — use the established Tailwind responsive patterns (see `HANDOFF_ROUND_4.md §3.2`)
- ✅ No emoji in code unless a function literally renders them to UI
- ✅ Comments only where the **why** is non-obvious — never narrate the **what**
- ✅ `git status` before declaring done shows ONLY files in your engine's domain + the targeted hook-ins from §6

---

## 10. What you must NOT do

- ❌ Touch any of the 7 existing engine files (`src/modules/{squat,plank,pushup,lunge,bicep-curl,tandem-stand,single-leg-stand}/*`)
- ❌ Touch their tests (`tests/scenarios/{squat,plank,...}`)
- ❌ Refactor `src/store/workout.ts` beyond adding `WarningType` entries
- ❌ Refactor shared report/play/setup pages beyond the targeted hooks in §6
- ❌ Rename existing symbols or move files around
- ❌ Add a second exercise without explicit go-ahead from Bilal
- ❌ Skip TypeScript errors, use `--no-verify`, or downgrade test rigor
- ❌ Write a long architecture doc — just write code, tests, and a one-paragraph note when you're done

---

## 11. Verification recipe

Before telling Bilal "ready for physical test":

```powershell
cd <path-to>\kriya-mirror

npx tsc --noEmit
# → must print nothing (exit 0)

npm run test:scenarios
# → must show "Tests: 161+N passed (161+N)" where N is your new test count

npm run dev
# → boots Next.js dev server. Navigate to http://localhost:3000/<your-id>/setup
```

Bilal will then physically test:
1. Walk through calibration → confirm it's near-instant (≤2 s) when standing in the right spot
2. Try the exercise → confirm reps count / hold accumulates correctly
3. Try BAD form deliberately → confirm warnings fire AND wrong-form gets discarded
4. Try standing still after calibration (rep-based) → confirm "Start moving" warning at 5 s
5. Try standing in a bad spot for 30 s (squat timeout) or 20 s (plank timeout) → confirm retry card appears
6. View report on desktop AND on 360 px-wide Chrome devtools mobile viewport → confirm CSS doesn't break

Bilal pastes the console log back. You analyze it line-by-line and fix anything that looks off.

---

## 12. When you finish

1. Tell Bilal: "Exercise `<id>` ready. Tests: 161+N green. tsc clean. Awaiting physical test."
2. Wait for physical-test verdict. Fix anything that comes back. **Expect 1–3 physical-test → fix → re-test rounds** — Amir averaged ~2 rounds per engine. Don't call it done after the first physical test.
3. Once Bilal confirms it passes: **stop**. Do NOT start another exercise. Bilal sends the diff back to Amir.
4. If Bilal wants you to start a second exercise, that's a new conversation with a new confirm-the-pick step.

---

## 13. Quick file map (so you don't have to search)

```
kriya-mirror/
├── CLAUDE.md                              ← auto-loads, read first
├── HANDOFF_ROUND_4.md                     ← Amir's round 1-5 pattern bible
├── PROMPT.md                              ← reusable session boot
├── .context/
│   ├── 00_START_HERE.md
│   ├── 01_ARCHITECTURE.md
│   ├── 02_EXERCISE_CHECKLIST.md           ← canonical step-by-step
│   ├── 03_KNOWN_ISSUES_TO_PREVENT.md
│   ├── 04_DEBUGGING_AND_TESTING.md
│   └── 05_DESIGN_RULES.md
├── src/
│   ├── config/exercises/
│   │   ├── index.ts                       ← register your config here
│   │   ├── squat.config.ts                ← reference (rep-based)
│   │   ├── plank.config.ts                ← reference (hold-based)
│   │   └── <id>.config.ts                 ← YOU CREATE
│   ├── modules/
│   │   ├── engine-interface.ts            ← read first to know what you must implement
│   │   ├── pose/                          ← MediaPipe wrapper + landmark types
│   │   ├── squat/      ← REFERENCE (rep-based)
│   │   ├── plank/      ← REFERENCE (hold-based)
│   │   └── <id>/                          ← YOU CREATE
│   ├── store/workout.ts                   ← add WarningType entries (only)
│   ├── lib/debug.ts                       ← debugLog utility — use this, not console.log
│   ├── components/                        ← don't modify, just reference
│   └── app/[exerciseId]/
│       ├── setup/page.tsx                 ← already works; your route inherits
│       ├── play/page.tsx                  ← add ONE engine-switch branch + warning speech entries
│       └── report/page.tsx                ← add WARNING_LABEL entries (only)
└── tests/
    ├── harness/
    │   ├── types.ts                       ← add <Id>PoseIntent
    │   ├── pose-stub.ts                   ← add build<Id>Pose
    │   ├── runner.ts                      ← add run<Id>Session
    │   └── frame-stream.ts                ← buildFrames helper, use as-is
    └── scenarios/
        ├── squat/                         ← reference (rep-based, 9 test files)
        ├── plank/                         ← reference (hold-based, 6 test files)
        ├── lunge/                         ← reference (rep + position-lost + EMA reseed, 9 test files)
        ├── bicep-curl/                    ← reference (rep + bilateral, 9 test files)
        └── <id>/                          ← YOU CREATE
```

---

## 14. If you get stuck

- Re-read the relevant `.context/*.md` file. It probably answers your question.
- Re-read `HANDOFF_ROUND_4.md` — Amir documented every bug he hit.
- Look at the squat or plank reference implementation for the exact pattern.
- Ask Bilal via `AskUserQuestion`. Don't guess.
- **Never** ship a workaround. If something feels wrong, it is wrong. Fix the root cause.

---

## 15. Final reminder

You are adding **one exercise**. Amir spent **8 rounds** of physical testing to surface the bugs that the existing 7 engines now handle correctly. You inherit all that learning for free — just follow the patterns. Don't reinvent. Don't shortcut. Don't bundle.

**One exercise. Tests green. Physical test passed. Stop.**

Good luck.

— prepared 2026-05-25 by Amir's session, after rounds 1–8 of physical testing
