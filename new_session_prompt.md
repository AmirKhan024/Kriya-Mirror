# Kriya Mirror — Reusable Session Onboarding Prompt

> **Paste this entire file into a fresh Claude Code session** opened at the `kriya-mirror` folder. The Claude reading this has never seen the project. By the end it should know exactly what to read, what to build, what NOT to touch, and what quality bar to hit.
>
> **This file is reusable.** Numbers (exercise counts, test counts) are NOT hardcoded — you discover them from the repo at the start of each session. The file does not need to be updated between sessions to stay accurate.
>
> **Supersedes** `bilal_prompt.md` (same idea, older content, hardcoded counts).
>
> **Note to Claude reading this file:** once you've read it through, treat the `.context/*.md` and `HANDOFF_ROUND_4.md` files as the canonical project docs. Don't keep this prompt in active reading rotation; come back only when you forget the rules.

---

## 0. Who you are and what you're doing

You are Claude Code, helping the developer (project owner: **Amir**) add ONE new exercise to **Kriya Mirror** — a Next.js 14 + TypeScript + MediaPipe camera-vision fitness coaching app.

You will:

1. **Discover the current state** of the project from the repo (§3).
2. **Read the existing project context** (§2) before touching anything.
3. **Pick ONE new exercise** from the master fitness library that isn't already shipped.
4. **Implement it end-to-end** applying every fix and policy from §5 — these are battle-tested patterns from 15+ rounds of physical testing. Don't skip any.
5. **Ship it to the same quality bar** as the shipped engines: TypeScript strict, all scenario tests green, physical test passed.
6. **Stop after one exercise.** Don't start a second without explicit go-ahead.

Your working directory is wherever the project is unzipped (typically `C:\Users\<user>\...\kriya-mirror\`).

---

## 1. Ground rules (non-negotiable)

- **Do not touch the shipped exercise engines.** They are field-validated. List discovered in §3.
- **Do not refactor shared components** (`src/store/workout.ts`, `src/app/[exerciseId]/{report,play,setup}/page.tsx`, `src/components/*`) beyond the targeted hook-ins listed in §6.
- **Do not bulk-edit.** One exercise. One PR-equivalent diff. One physical test cycle.
- **Do not skip tests or use `--no-verify`.** If something fails, fix the root cause.
- **Do not add a new exercise category** if your pick fits an existing one.
- **Do not invent design patterns.** Mirror what the reference engines already do (squat for rep-based, plank for hold-based).

---

## 2. Boot sequence — read these BEFORE writing any code

In this exact order. Use the `Read` tool — do not skim.

1. **`CLAUDE.md`** at the repo root — auto-loads but verify you've absorbed it.
2. **`.context/00_START_HERE.md`** — project orientation.
3. **`.context/01_ARCHITECTURE.md`** — engine interface, store, exercise registry, routing.
4. **`.context/02_EXERCISE_CHECKLIST.md`** — the canonical step-by-step pipeline for adding any new exercise. **This is your bible.**
5. **`.context/03_KNOWN_ISSUES_TO_PREVENT.md`** — every footgun that caused a physical-test regression.
6. **`.context/04_DEBUGGING_AND_TESTING.md`** — how the test harness works, how `debugLog` and `localStorage.KRIYA_DEBUG_LEVEL` work.
7. **`DEBUGGING.md`** at the repo root — the long-form debugging cookbook.
8. **`.context/05_DESIGN_RULES.md`** — UI rules (Rule A: one chip at a time; Rule B: audio no-cutoff; Rule C: readable from 2 m).
9. **`HANDOFF_ROUND_4.md`** at the repo root — patterns from rounds 1-5. Cross-reference only; most details are in §5 below.
10. **`kriya-mirror-fitness-library.md`** — the master spec (shared separately, NOT in the repo). Defines the full catalog with equipment, muscles, tracking landmarks, instructions, common errors. You pick from this list.
11. **`README.md`** at the repo root — boot commands.

Don't write code until you've read all eleven. If any file is missing, ask the user.

---

## 3. Discover the shipped exercises — DO NOT hardcode the list

The shipped-engine count grows over time. **Never trust a static list** in this or any other doc. Always re-derive from the repo:

```powershell
# In Powershell (or equivalent):
ls src/modules/                       # one folder per shipped engine
cat src/config/exercises/index.ts     # registered IDs
```

Exclude `pose/`, `geometry/`, `camera/`, `engine-interface.ts` — those are shared infrastructure, not exercises.

**Every other folder under `src/modules/` is OFF-LIMITS for editing.** Use them as patterns to copy. Treat the matching `tests/scenarios/<id>/` folders the same way.

---

## 4. How to pick your exercise

1. Read `kriya-mirror-fitness-library.md` (shared separately).
2. Filter to exercises that are:
   - **Camera-vision trackable** — MediaPipe BlazePose gives you 33 landmarks. If the exercise needs landmarks BlazePose can't see (wrist rotation, finger position, contact pressure), skip it. The library's "MediaPipe Verdict" column is your guide: aim for ✅ **100% trackable**.
   - **Not in the shipped list** (§3).
   - **Single-mode** — pick "rep-based" (counted reps) or "hold-based" (timed hold). Don't invent a third mode.
3. **Use `AskUserQuestion`** to confirm your pick with the user before starting. Show 2–3 candidates with one-line reasons each. Let the user choose.
4. Once chosen, lock the `id` (kebab-case, e.g. `mountain-climber`, `wall-sit`, `glute-bridge`) and tell the user. That ID propagates everywhere.

---

## 5. THE FIX LIST — apply every one of these to your engine

Every row below was a real physical-test bug surfaced in a prior round. Skipping any guarantees you re-introduce that bug. Reference engines are listed for each — read the pattern, copy the structure, don't paraphrase.

| # | Round | Name | Applies | What to do |
|---|---|---|---|---|
| **A** | 5 | Warning-spam gating | rep + hold | rep: gate warning emissions to `repState !== 'STANDING'` (or `'EXTENDED'` etc.); hold: warnings only emit inside `processHoldFrame()` which runs post-cal. Without this, warnings spam during rest. |
| **B** | 5 | "Wrong gets discarded" | rep + hold | rep: `validateRepShape()` rejects bad reps; hold: `accumulatedValidMs` freezes the timer during sustained bad form. Mirror plank `engine.ts` for the freeze pattern. |
| **C** | 5 | `durationMs` reset-order | rep | call `resetRepBuffers()` BEFORE `repStartedAt = now` on the rest→active transition. Reversing it zeros the timestamp and every REP/REJECT log reports `durationMs: 0`. |
| **D** | 5 | Validation reject-reason order | rep | unilateral / bilateral-symmetry checks come BEFORE depth checks. A one-arm deep curl should report `unilateral`, not `incomplete-curl`. Skip if your exercise is intentionally unilateral (like lunge). |
| **E** | 5 | `TIMER frozen/resumed` debug logs | hold | `debugLog('<TAG>', 'TIMER', 'frozen' / 'resumed', { reason, accumulatedSec })` on freeze edges. Critical for log-based debugging when the user pastes console output. |
| **F** | 5 | Calibration distance-gate hysteresis | both (if dist is noisy) | Separate ENTER/EXIT thresholds so frame jitter doesn't flip the gate. Reference: plank calibration. |
| **G** | 5 | Instant calibration | both | `CONFIRM_DURATION_MS = 200` (NOT 2000) — confirms ~instantly once gates green, with a 6-frame MediaPipe debounce. |
| **H** | 5 | Distance hints | both | Calibration emits `distanceHint: 'too-close' \| 'too-far' \| null` whenever the body-length or shoulder-width check fails. |
| **I** | 5 | 5 s idle warning | rep | `NO_MOVEMENT_TIMEOUT_MS = 5000`; repeat every 15 s; initialize `standingSince`/`extendedSince` to `now` on cal-confirm (else first frame reports millions of ms idle → instant false-positive). |
| **J** | 5 | Calibration timeout retry | both | Engine sets `state: 'timeout'` after `TIMEOUT_MS = 20_000`; play page handles the retry UI. Already wired — verify, don't reinvent. |
| **K** | 5 | Glossary | both | Use existing `GlossaryRepBased` / `GlossaryHoldBased` in report page — don't touch unless you add a brand-new user-facing metric. |
| **L** | 5 | Mobile CSS | both | Follow `HANDOFF_ROUND_4.md §3.2` — text-7xl→5xl on mobile, grid-cols-3→1 for forms. Test on 360 px width before declaring done. |
| **M** | 5 | Chart axes | hold | If you add a chart, follow `FormTimeChart` convention — labelled x-axis (seconds), y-axis, axis titles. |
| **N** | 6 | `position-lost` engine wiring | rep + hold | After cal-confirm, if no usable landmarks for ≥ 3 s, emit `'position-lost'`. Repeats every 10 s while lost. UI infra (chip / voice / report) is already complete. Your engine adds: constants `POSITION_LOST_TIMEOUT_MS = 3000` + `POSITION_LOST_REPEAT_MS = 10_000`; fields `lastValidFrameAt` + `lastPositionLostWarnAt`; helper `hasCoreLandmarks()`; method `checkPositionLost()`; call site at the TOP of `update()` BEFORE the existing landmark-null early-return. Add a `position-lost` scenario test. |
| **O** | 7 | Post-rep EMA-decay reseed | rep | After a rep returns to STANDING/EXTENDED, EMA-smoothed flexion decays exponentially from peak toward rest. The decay tail inflates `max - min`, so the `not-moving` variance gate never closes after a real rep. Fix: when per-frame `\|smoothed - prevSmoothed\| < 0.3°` holds for 500 ms, reseed `flexionMin/Max` from the current value AND reset `since = now`. Reset the reseed flags in 4 sites: cal-confirm init, the LOWERING/ASCENDING → rest transition, after a `not-moving` fire, and the early-return branch in `checkNoMovement`. Reference: lunge `standingSettledSince` / `standingBaselineReseeded`. Add a `not-moving-after-rep` scenario test. |
| **P** | 7 | Cold-start cooldown sentinel | rep | `firstFireAllowed = this.lastNoMovementWarnAt === 0 \|\| now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;`. Without this, the initial 0 value blocks the FIRST `not-moving` warning when engine `now` is still small. Apply alongside Fix I. |
| **Q** | 5/6 | Calibration overlay text branch | both | `src/app/[exerciseId]/play/page.tsx` ~L530-590 has a switch over `exercise?.engineModule`. Without your branch the user sees squat's misleading "Stand facing the camera, feet wide, arms overhead" copy. Add a branch in (1) the title block AND (2) each of the 3 CheckRow labels (`fullBodyVisible` / `feetWide` / `armsOverhead` — remap to your exercise's actual semantics). |
| **R** | 8 | Ballistic-velocity threshold is exercise-specific | rep | Don't blindly copy squat's `MAX_HIP_VELOCITY = 1.5`. The threshold depends on WHICH landmark you track (hip / shoulder / wrist) and how far it travels per rep. Reference values after physical testing: squat & lunge hip = **1.5**, push-up shoulder = **3.0**, bicep curl wrist = **4.0**. Pick the closest analog, then EXPECT to tune during physical test. |
| **S** | 9 | **Recoverable form-break, not terminal** | hold | Form warnings (sway, feet-separated, foot-dropped) should **FREEZE the timer**, not end the workout. Only "user fully stood up" (shoulder-rise ≥ ~15%) terminates the hold. Reference: tandem-stand round 9, SLS round 11. The user can recover and continue. |
| **T** | 9 | **Coaching cue with long cooldown** | hold | Subtle warnings (hands-off-hips type) fire once, then suppress for 10–12 s. **Do NOT freeze the timer** for these — they're verbal nudges, not structural failures. Reference: tandem-stand `evaluateHandsOffHips`. |
| **U** | 9/10 | **Longest-hold streak on report (with 1 s debounce)** | hold | Track `currentStreakValidMs` + `streakBreakStartedAt` + `streakBreakCommitted`. A freeze blip shorter than `MIN_STREAK_BREAK_MS = 1000` is absorbed into the ongoing streak. Tick payload includes `longestUnfrozenSec`. Report's primary stat shows "Longest hold: Xs" (NOT total valid time). Reference: tandem-stand round 10, SLS round 10. |
| **V** | 12 | **Warn-state hysteresis (paired entry/exit debounce)** | hold | Every form-warning needs paired `*BadFrames` / `*GoodFrames` counters and a sticky `*WarnActive` flag. Entry requires N consecutive bad frames; exit requires N consecutive good frames. Without this, MediaPipe single-frame jitter chatters the timer freeze on/off. Use `SWAY_RESUME_FRAMES = SWAY_WARN_FRAMES = 6` (200 ms each way at 30 fps). Reference: SLS / tandem-stand round 12. |
| **W** | 12 | **EMA-smoothing α tuned per engine** | hold | `0.30` is too snappy for noisy hold-based engines. Use `0.20` (167 ms time constant). Real postural sway > 200 ms still trips the 6-frame entry debounce. Don't copy rep-based α values blindly. |
| **X** | 13 | **MIN_SHOULDER_WIDTH guard at cal + runtime floor** | both | At calibration: reject confirmation when `shoulderWidth < 0.08` (treat as `'too-far'`). At runtime: every distance-normalized threshold uses `Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME)` where `MIN_SHOULDER_WIDTH_RUNTIME = 0.08`. Without this, MediaPipe's bad-frame baselines (shoulderWidth = 0.024) collapse every threshold and every form warning fires constantly. Also: `FormTimeChart` must handle `maxT <= 0` (empty / zero-duration series). |
| **Y** | 14 | **Multi-landmark confirmation for lift gates** | hold | NEVER use ankle Y alone for "is leg lifted" or "is foot dropped". Require knee Y AND ankle Y to BOTH agree. MediaPipe ankle is noisy at the frame edge; knee is more stable. At cal: `oneFootLifted = ankleLifted && kneeLifted`. At hold: `footDroppedBad = ankleDelta < ... && kneeDelta < ...`. Pick `liftedSide` from KNEE Y, not ankle Y. Reference: SLS round 14. |
| **Z** | 15 | **Exercise-specific sway / threshold tuning** | hold (balance) | Don't share `SWAY_WARN_ANGLE_DEG` across exercises with different stance bases. Single-leg standing has 3-5 cm of normal CoM sway (4-7° angle) → needs **12°** threshold. Tandem stand has wider base, less sway → **6°** is correct. Similarly tune `HOLD_BASELINE_FRAMES` (longer for noisier exercises — SLS uses 30 frames vs tandem's 10) so wobble during baseline capture doesn't bias the reference. |

**Most-often-forgotten by fresh sessions**: Fixes **Q** (overlay text), **V** (hysteresis), **X** (shoulder-width floor), **Y** (knee-confirmed lift). If you only remember four, remember those.

> **About the F–Z letter convention**: `HANDOFF_ROUND_4.md` literally defines only Fixes **A–E**. Letters F–M are cross-cutting POLICIES from HANDOFF §3.x (F→§3.4, G→§3.5, H→§3.6, I→§3.7, J→§3.8, K→§3.3, L→§3.2, M→§3.1). Letters **N–Z** are from rounds 6–15 and live in this prompt + the reference engines' code. `grep "Fix V"` in HANDOFF will find nothing — that's expected.

---

## 6. Code recipe — files you will create or extend

### New files (in your exercise's own folder — safe to create):

```
src/config/exercises/<id>.config.ts          # exercise metadata + defaults
src/modules/<id>/engine.ts                   # your ExerciseEngine implementation
src/modules/<id>/calibration.ts              # gates, distance hint, hysteresis
src/modules/<id>/scoring.ts                  # MQS formula (mirror plank/squat)
src/modules/<id>/types.ts                    # local interfaces
src/modules/<id>/geometry.ts                 # only if you need helpers beyond squat/geometry

tests/scenarios/<id>/01-happy-path.test.ts
tests/scenarios/<id>/02-validation.test.ts   # (rep) or 02-sway-detection / 02-deviations (hold)
tests/scenarios/<id>/03-posture-warnings.test.ts
tests/scenarios/<id>/04-calibration.test.ts  # INCLUDE the round-13 narrow-shoulderWidth rejection case
tests/scenarios/<id>/05-<discard-or-gating>.test.ts
tests/scenarios/<id>/06-discard-bad-form-time.test.ts   # hold only; covers Fix B + Fix U streak debounce
tests/scenarios/<id>/06-distance-gate-hysteresis.test.ts # rep + hold (if your dist check is noisy)
tests/scenarios/<id>/07-position-lost.test.ts            # Fix N (REQUIRED both)
tests/scenarios/<id>/08-hands-off-hips.test.ts           # hold only, ONLY if you implement Fix T

# Rep-based engines also add:
tests/scenarios/<id>/13-not-moving-init.test.ts          # Fix I + Fix P
tests/scenarios/<id>/14-not-moving-after-rep.test.ts     # Fix O
tests/scenarios/<id>/15-warning-gating-during-<idle>.test.ts  # Fix A regression
```

Numbering is loose — squat's actual files use 13/14/15/17 for these. Pick numbers that don't collide with your earlier files.

### Files you will EXTEND (precise hook-ins only):

| File | What you add |
|---|---|
| `src/config/exercises/index.ts` | One line: import + push into `ALL_EXERCISES` |
| `src/store/workout.ts` | New entries in `WarningType` union (any new warnings unique to your engine) + matching entries in `emptyWarningCounts()` |
| `src/app/[exerciseId]/play/page.tsx` | One branch in the engine-routing switch (~L304-349); one entry per new warning in `WARNING_PRIORITY` and `WARNING_SPEECH`; **AND a branch in the calibration overlay block at ~L530-590 (Fix Q — easy to miss).** Threading: if your engine emits `longestUnfrozenSec` on hold ticks, `handleHoldTick` must forward it to `recordHoldTick`. |
| `src/app/[exerciseId]/report/page.tsx` | One entry per new warning in `WARNING_LABEL` + matching `newWarningTotals()` key (bottom of file) |
| `src/components/PostureWarningChip.tsx` | If you add a new warning type: entries in `STRINGS` and `URGENT_OVERRIDE` |
| `tests/harness/types.ts` | `<Id>PoseIntent` type — the inputs your test scenarios pass to the pose synthesizer |
| `tests/harness/pose-stub.ts` | `build<Id>Pose(intent)` — synthesizes a 33-landmark array from intent fields |
| `tests/harness/runner.ts` | `run<Id>Session(frames)` — runs your engine through a frame stream and captures all events |
| `src/components/ImageTextMode.tsx` | ONLY if your exercise needs custom on-screen instruction copy/diagrams. There's a per-`exercise.id` switch (~L70) — add a branch for your id. Otherwise leave alone. |

**Do not edit anything else in those shared files.** If you think you need to, stop and ask the user.

> **Video URL** — most existing exercise configs have a `videoUrls.youtube` short-link field. Leave it `null` for the initial ship; the user will add a real link later.

---

## 6.5 Baseline-shape adaptation (only if your calibration needs different fields than squat)

The shared `CalibrationUpdate.baseline` field is typed as **squat's** `CalibrationBaseline` shape (hipMid, shoulderMid, hipWidth, shoulderWidth, torsoHeight, ankleY, feetWidth, feetVsShoulderRatio, leftKneeX, rightKneeX). The play page reads this shape uniformly.

If your engine needs different baseline fields:

1. Define a local `<Id>Baseline` interface in `src/modules/<id>/types.ts` with the fields YOUR engine needs.
2. Inside the engine, capture into the local shape: `private baseline: <Id>Baseline | null = null`.
3. In `calibration.ts`, write an adapter `function toSquatBaseline(b: <Id>Baseline): CalibrationBaseline` populating only the squat fields the play page reads (others default to 0 or are computed).
4. `CalibrationUpdate.baseline` returned to the play page uses the adapted shape.

**Reference**: `src/modules/lunge/calibration.ts` `toSquatBaseline()` (~L217-230) and `src/modules/bicep-curl/calibration.ts`.

---

## 7. Test rigor expected

Mirror what shipped for squat (rep-based, ~9 test files), plank (hold-based, ~6), lunge (rep + position-lost + EMA reseed, ~9), bicep-curl (rep + bilateral, ~9), tandem-stand & single-leg-stand (hold + balance, ~7-8 each).

**Always required (rep + hold):**
- **01-happy-path** — clean execution → expected reps OR hold tick at target time
- **02-validation** (rep) or **02-sway-detection** (hold)
- **03-posture-warnings** — each warning fires when it should + debounce works
- **04-calibration** — gates pass/fail correctly, `distanceHint` populates, instant confirm works (~200 ms), **PLUS the round-13 narrow-shoulderWidth rejection case (Fix X)**
- **05-warning-gating-during-<idle-state>** (rep) or **05-discard-bad-form-time** (hold)
- **07-position-lost** — Fix N regression (null landmarks for 4 s → fires; clean stream silent; respects 10 s cooldown)

**Only if your distance check is noisy:**
- **06-distance-gate-hysteresis** — copy `tests/scenarios/plank/06-distance-gate-hysteresis.test.ts`

**Hold-based only:**
- **06-discard-bad-form-time** — Fix B (freeze) + Fix U (streak-debounce) + Fix V (hysteresis) — covers all three
- **08-hands-off-hips** (only if you implement Fix T)
- For hold-based with `hold-broken`: also test the structural-failure mode

**Rep-based only (rounds 5-7 regressions, ALL required):**
- **13-not-moving-init** — Fix I + Fix P
- **14-not-moving-after-rep** — Fix O (catches the EMA-decay-tail bug)
- **15-warning-gating-during-<idle-state>** — Fix A (posture warnings silent during rest)

---

## 8. Per-step process — the loop

Follow this order. Each step is a checkpoint — don't move on until it's clean.

1. **Capture the baseline.** `npm run test:scenarios` → note the green test count as `BASELINE`. `npx tsc --noEmit` → must already be clean.
2. **Confirm exercise pick.** `AskUserQuestion` with 2-3 candidates → user chooses → lock ID.
3. **Add config + register.** Just enough that `/<id>/setup` renders. `npm run dev` and verify the page loads.
4. **Stub calibration + engine.** Implement `update()` and `finish()` as no-ops. Page should boot to camera but show "waiting" forever.
5. **Implement calibration gates.** Including hysteresis (F), instant confirm (G, 200 ms), distance hints (H), timeout (J), **MIN_SHOULDER_WIDTH guard (X)**, and **multi-landmark lift confirmation if applicable (Y)**.
6. **Write `04-calibration.test.ts`** (including the X regression case). Run scenarios — should be green.
7. **Implement engine state machine.** Rep-based: STANDING / DESCENDING / AT_BOTTOM / ASCENDING (or analog). Hold-based: `processHoldFrame()` with `accumulatedValidMs` + hysteresis + streak-tracking.
8. **Add per-frame warning emission.** With Fix A gating, Fix C reset-order (rep), Fix D validation order (rep), Fix E TIMER logs (hold), **Fix V hysteresis (hold)**, **Fix Q overlay text branch (both)**.
9. **Add idle detection (Fix I, rep only).** Initialize idle counter on cal-confirm. Add Fix O reseed + Fix P cold-start cooldown.
10. **Add position-lost wiring (Fix N, both).**
11. **For hold-based: add Fix S (recoverable form-break) + Fix U (longest-streak tracking).** Tick payload includes `longestUnfrozenSec`.
12. **Implement scoring.** Mirror `plank/scoring.ts` or `squat/scoring.ts`. Adjust thresholds per **Fix Z**.
13. **Write all scenario tests.** Each passes before moving on.
14. **Wire play page route + warning text + report label + overlay text branch.** Targeted edits per §6.
15. **`npx tsc --noEmit`** → clean.
16. **`npm run test:scenarios`** → `BASELINE + N` green where N is your new tests. No baseline tests regressed.
17. **`npm run dev`** + user physical-tests. Paste console logs.
18. **Iterate on physical-test feedback.** Expect 1–3 rounds. Don't say "done" until the user confirms.

---

## 9. Debugging & console-log analysis

`debugLog(engineTag, category, message, data)` from `src/lib/debug.ts` is the only logging mechanism. Never use `console.log`.

**Standard categories**: `CALIB`, `HOLD`, `REP`, `REJECT`, `WARN`, `TIMER`, `BROKEN`, `TICK`.

When the user pastes console logs, **read the first hold-line carefully**:
```
[<TAG>][HOLD] Hold started | {"shoulderWidth": X, ...}
```

**Diagnostic checklist by symptom:**

| Symptom in logs | Likely cause | Fix |
|---|---|---|
| `shoulderWidth: 0.0XX` (less than 0.08) | Degenerate baseline locked in | Fix X (calibration MIN_SHOULDER_WIDTH guard + runtime floor) |
| `[TIMER] frozen` → `resumed` cycles repeatedly with sub-200 ms freeze durations | Warn-state has no resume hysteresis | Fix V (paired entry/exit debounce) |
| `WARN <type>` firing every ~2.5 s but no `[TIMER]` `resumed` event | warn-active state is stuck on, never clears | Fix V (likely missing exit hysteresis); check that good frames eventually accumulate |
| `position-lost \| { lostMs: X }` | Frame source isn't delivering usable landmarks | Not an engine bug — check camera setup, lighting, person is in frame |
| Hold accumulator stuck near 0 throughout session | Degenerate baseline OR warning never clears | Combine Fix X + Fix V diagnosis |
| `REJECT ballistic, durationMs: 0` | Reset-order bug | Fix C (resetRepBuffers BEFORE repStartedAt) |
| `WARN not-moving` firing immediately on cal-confirm | idle counter not initialized | Fix I (seed `*Since = now` on cal-confirm) + Fix P (cold-start cooldown) |
| Multiple `REJECT ballistic` at 2-4 s rep durations | Threshold too tight for the landmark | Fix R (per-exercise velocity threshold) |
| `oneFootLifted: true` when user is NOT lifting | Cal too lenient on a single landmark | Fix Y (knee-confirmed lift) |
| Form fine but `swaying` fires constantly on hold-based balance | Threshold not exercise-specific | Fix Z (raise SLS-style sway threshold to 12°, keep tandem at 6°) |

**Log-trace technique**: timestamps in logs (`t=XXXXXms`) are wall-clock. Look at gaps:
- Gap between adjacent `TIMER frozen/resumed` events < 1 s → jitter, see Fix V or Fix U
- Gap between `Hold started` and first `WARN` < 500 ms → almost always a degenerate-baseline issue (Fix X)
- Gap between `Hold baseline captured` and first `WARN` < 200 ms → same; baseline was off-center

---

## 10. Anti-patterns — DO NOT REPEAT THESE

The 15 rounds of physical testing surfaced these specific mistakes. A fresh session that respects these doesn't need to repeat the cycle.

1. **Don't pass cal with `shoulderWidth < 0.08`.** It collapses every distance-normalized threshold. Add the calibration reject + runtime floor (Fix X).
2. **Don't use ankle Y alone for "is foot lifted".** Require the knee landmark to agree (Fix Y).
3. **Don't terminate the workout on recoverable form breaks.** Feet drift apart, foot drops briefly, sway spikes → freeze the timer and warn. Only "user fully stood up" ends the hold (Fix S).
4. **Don't reset the longest-hold streak on every freeze blip.** Use the 1 s debounce (Fix U). Sub-second blips are part of one streak from the user's perspective.
5. **Don't make the warn state toggle on a single good frame.** Add paired entry/exit hysteresis (Fix V). MediaPipe jitter will chatter on/off otherwise.
6. **Don't share `SWAY_WARN_ANGLE_DEG` across exercises with different stance bases.** Single-leg needs 12°; tandem needs 6° (Fix Z).
7. **Don't share `SMOOTHING_ALPHA = 0.30` across all engines.** Hold-based with MediaPipe noise gets 0.20 (Fix W).
8. **Don't reuse squat's `MAX_HIP_VELOCITY = 1.5` for distal landmarks.** Push-up shoulder = 3.0, bicep wrist = 4.0 (Fix R). Wrist/shoulder noise scales with arc length.
9. **Don't divide by raw `baseline.shoulderWidth` at runtime.** Use `Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME)` (Fix X). Defense in depth even if calibration usually catches the bad value.
10. **Don't let `FormTimeChart` receive an empty / zero-duration series.** Guard `maxT <= 0` with a "Hold never advanced" fallback message. Without this you get hundreds of SVG NaN errors in dev.
11. **Don't fall through to the plank / squat default calibration overlay text.** Add an `engineModule === '<your-id>'` branch in `play/page.tsx` ~L530-590 (Fix Q). This is the most-overlooked fix.
12. **Don't put MediaPipe noise suppression behind only one debounce layer.** Entry debounce + exit debounce + EMA smoothing catch different jitter modes. Stack all three.
13. **Don't initialize idle/freeze timestamps to 0.** Always seed to `now` on cal-confirm — otherwise the first frame reports millions of ms idle (Fix I).
14. **Don't ship without a `position-lost` test.** It's a 4-case regression test that catches major frame-handling regressions.
15. **Don't claim "done" after one physical test.** Expect 1–3 fix → test cycles per engine. Five rounds isn't unusual for a complex engine.

---

## 11. Quality gates (non-negotiable)

- ✅ TypeScript strict — no `any`, no `@ts-ignore`, no `unknown` casts you don't understand
- ✅ Every scenario test passes — no `.skip`, no `xfail`, no commented-out assertions
- ✅ No `console.log` in committed code — use `debugLog(engineTag, category, message, data)` from `src/lib/debug.ts`
- ✅ No commented-out code blocks left behind
- ✅ No new npm dependencies without asking the user first
- ✅ No new global CSS — use the established Tailwind responsive patterns (see `HANDOFF_ROUND_4.md §3.2`)
- ✅ No emoji in code unless a function literally renders them to UI
- ✅ Comments only where the **why** is non-obvious — never narrate the **what**
- ✅ `git status` before declaring done shows ONLY files in your engine's domain + the targeted hook-ins from §6

---

## 12. What you must NOT do

- ❌ Touch any of the shipped engine files or their tests (discovered in §3)
- ❌ Refactor `src/store/workout.ts` beyond adding `WarningType` entries
- ❌ Refactor shared report/play/setup pages beyond the targeted hooks in §6
- ❌ Rename existing symbols or move files around
- ❌ Add a second exercise without explicit go-ahead
- ❌ Skip TypeScript errors, use `--no-verify`, or downgrade test rigor
- ❌ Write a long architecture doc — just write code, tests, and a one-paragraph note when you're done

---

## 13. Verification recipe

Capture the baseline BEFORE you touch anything:

```powershell
cd <path-to>\kriya-mirror

npx tsc --noEmit
# → must print nothing (exit 0). Note: BASELINE_TSC_CLEAN = true.

npm run test:scenarios
# → note the green count printed at the end. Call this BASELINE.
```

After your work, BEFORE telling the user "ready for physical test":

```powershell
npx tsc --noEmit
# → still prints nothing.

npm run test:scenarios
# → green count = BASELINE + N where N is the number of new test cases you added.
# → no baseline test went red.

npm run dev
# → boots Next.js dev server. Navigate to http://localhost:3000/<your-id>/setup
```

The user will then physically test:
1. Walk through calibration → confirm it's near-instant (≤ 2 s) in a good spot. If they're too far → confirm `too-far` hint shows (Fix X).
2. Try the exercise → reps count / hold accumulates correctly.
3. Try BAD form deliberately → confirm warnings fire AND wrong-form gets discarded.
4. (rep-based) Stand still after cal → confirm "Start moving" warning at ~5 s.
5. (hold-based) Try recoverable form-break (drop foot, separate feet, etc.) → counter freezes, warning fires, on recovery counter resumes. Only "fully stand up" should terminate (Fix S).
6. Step out of camera for 3+ s → `position-lost` chip + voice fire (Fix N).
7. (rep-based) Try standing in bad spot 30 s → retry card appears (Fix J).
8. View report on desktop AND on 360 px-wide Chrome devtools mobile viewport → CSS doesn't break (Fix L).

The user pastes the console log back. You analyze it line by line using §9 and fix anything that looks off.

---

## 14. When you finish

1. Tell the user: "Exercise `<id>` ready. Tests: BASELINE+N green. tsc clean. Awaiting physical test."
2. Wait for physical-test verdict. Fix anything that comes back. **Expect 1–3 physical-test → fix → re-test rounds** — even battle-tested patterns sometimes need per-exercise tuning (especially Fix R and Fix Z).
3. Once the user confirms it passes: **stop**. Do NOT start another exercise unprompted.

---

## 15. Quick file map (so you don't have to search)

```
kriya-mirror/
├── CLAUDE.md                              ← auto-loads, read first
├── HANDOFF_ROUND_4.md                     ← rounds 1-5 pattern bible
├── DEBUGGING.md                           ← long-form debugging cookbook
├── new_session_prompt.md                  ← THIS FILE (canonical onboarding)
├── bilal_prompt.md                        ← superseded historical version
├── PROMPT.md                              ← short reusable session boot
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
│   │   ├── <shipped engines>.config.ts    ← references (squat / plank / etc.)
│   │   └── <id>.config.ts                 ← YOU CREATE
│   ├── modules/
│   │   ├── engine-interface.ts            ← read first to know what you must implement
│   │   ├── pose/                          ← MediaPipe wrapper + landmark types
│   │   ├── <shipped engines>/             ← REFERENCES — discover with `ls src/modules/`
│   │   └── <id>/                          ← YOU CREATE
│   ├── store/workout.ts                   ← add WarningType entries (only)
│   ├── lib/debug.ts                       ← debugLog utility — use this, not console.log
│   ├── components/                        ← don't modify (except the noted hook-ins)
│   └── app/[exerciseId]/
│       ├── setup/page.tsx                 ← already works; your route inherits
│       ├── play/page.tsx                  ← add engine-switch branch + warning speech + OVERLAY TEXT BRANCH
│       └── report/page.tsx                ← add WARNING_LABEL entries (only)
└── tests/
    ├── harness/
    │   ├── types.ts                       ← add <Id>PoseIntent
    │   ├── pose-stub.ts                   ← add build<Id>Pose
    │   ├── runner.ts                      ← add run<Id>Session
    │   └── frame-stream.ts                ← buildFrames helper, use as-is
    └── scenarios/
        ├── <shipped engines>/             ← REFERENCES
        └── <id>/                          ← YOU CREATE
```

---

## 16. If you get stuck

- Re-read the relevant `.context/*.md` file. It probably answers your question.
- Re-read `HANDOFF_ROUND_4.md` and §5 above — every fix is documented somewhere.
- Look at the reference engines for the exact pattern. The most recent ones (single-leg-stand, tandem-stand, bicep-curl, lunge) have the most fixes layered in.
- Re-read §9 (debugging) when console logs surface an unexpected pattern.
- Re-read §10 (anti-patterns) when something feels familiar but you can't place it.
- Ask the user via `AskUserQuestion`. Don't guess.
- **Never** ship a workaround. If something feels wrong, it is wrong. Fix the root cause.

---

## 17. Final reminder

You are adding **one exercise**. The user spent **15+ rounds** of physical testing to surface the bugs that the shipped engines now handle correctly. You inherit all that learning for free — just follow the patterns and the anti-patterns. Don't reinvent. Don't shortcut. Don't bundle.

**One exercise. Tests green. Physical test passed. Stop.**

Good luck.

— prepared 2026-05-25 after rounds 1–15 of physical testing. **Reusable across future sessions** — the shipped-exercise list, test counts, and current state are all discovered from the repo, not pinned in this file. New rounds may have shipped since; check `git log` for context.
