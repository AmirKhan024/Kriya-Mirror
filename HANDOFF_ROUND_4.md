# Kriya Mirror — Handoff for Round 4 (apply shipped fixes to the remaining 5 engines)

> **You are a fresh Claude Code session.** Your job is to apply the same set of upgrades to the 5 remaining exercise engines in this repo, after they've been validated on squat (rep-based) + plank (hold-based). Read this whole file before touching anything. The reference implementations are already shipped — you're mirroring, not inventing.

---

## 0. Project boot

- `CLAUDE.md` at the repo root auto-loads when a session opens this directory. Read it first.
- `PROMPT.md` has a reusable bootstrap if you want to re-read the high-level overview.
- `.context/` contains the deep architecture docs. Most relevant for this round:
  - `.context/01_ARCHITECTURE.md` — engine interface, store, exercise registry
  - `.context/03_KNOWN_ISSUES_TO_PREVENT.md` — patterns to NOT repeat
- Repo location on disk: `C:\Users\Amir Khan\Desktop\kriya-main\kriya-mirror\`
- Stack: Next.js 14 App Router · TS strict · MediaPipe tasks-vision 0.10.32 · Zustand 5 · Vitest 4 · Tailwind

**Standing rule from the user (Amir):** one exercise at a time, always physically validated before moving on. Do NOT bulk-ship all 5 engines. Pick one, build it, write the test, run typecheck + scenarios. Then ship it for physical test before starting the next.

---

## 1. What's already shipped (reference implementations)

| Round | Scope | Engine | Status |
|---|---|---|---|
| Round 1 | Build out all 7 exercises | (all) | ✅ shipped |
| Round 2 | Squat physical-test fixes | `src/modules/squat/engine.ts` | ✅ shipped & field-validated |
| Round 3 | Plank physical-test fixes + "wrong gets discarded" | `src/modules/plank/engine.ts` | ✅ shipped & field-validated |
| Round 4 | Chart axes, mobile CSS, plank calibration hysteresis | various | ✅ shipped |
| Round 5 (this) | Instant calibration (200 ms), 5 s idle warning, distance hints / retry policy docs | plank+squat calibration, squat engine, this handoff | ✅ shipped |

**Test baseline at handoff time: 136 scenarios green** (`npm run test:scenarios`).

---

## 2. The 5 fixes (A–E) that need to mirror across remaining engines

Each remaining engine needs some subset of these. The per-engine recipes in §4 say exactly which.

### Fix A — Warning-spam gating (rep-based engines)
**Problem:** posture warnings (heel-lift, valgus, hip-sag, etc.) fire every frame after calibration, including between reps while the user is standing still doing nothing. Coaching "fix your heels" when the user isn't moving is noise.

**Reference:** [src/modules/squat/engine.ts:264-273](src/modules/squat/engine.ts#L264-L273)
```ts
const inActiveRep = this.repState !== 'STANDING';
if (inActiveRep) {
  this.maybeEmitWarning('heel-lift', heelLifted, now);
  this.maybeEmitWarning('valgus', kneesValgus, now);
  this.maybeEmitWarning('trunk-forward', trunkBad, now);
  this.maybeEmitWarning('feet-narrow', feetTooNarrow, now);
}
// Distance / facing warnings still fire regardless of rep state:
this.maybeEmitWarning('not-facing', notFacing, now);
this.maybeEmitWarning('too-close', tooClose, now);
this.maybeEmitWarning('too-far', tooFar, now);
```

**Rule of thumb:** gate "form coaching" warnings to active rep phase. Keep "tracking validity" warnings (distance / facing / not-moving) ungated.

### Fix B — "Wrong gets discarded"
**Rep-based:** reps that fail `validateRepShape()` (too-shallow / unilateral / ballistic / collapsed-knees-style) emit a `malformed-rep` warning and do NOT count.

**Reference (rep-based):** [src/modules/squat/engine.ts:356-412](src/modules/squat/engine.ts#L356-L412) — `validateRepShape()` returns `{ ok: false, reason: ... }` and the rep is skipped.

**Hold-based:** while a sustained posture warning is currently active, the hold-time counter FREEZES. Brief wobbles (under the 6-frame debounce) don't deduct.

**Reference (hold-based):** [src/modules/plank/engine.ts:172-200](src/modules/plank/engine.ts#L172-L200) — `accumulatedValidMs` field, `formBroken` per frame, dt accumulated only when not broken. `TIMER frozen / resumed` debug logs on the edges. **Coaching-cue warnings (e.g. neck-droop) are excluded from the freeze list** — only structural failures.

### Fix C — `durationMs:0` reset-order bug (rep-based only)
**Problem:** on STANDING → DESCENDING transition, `repStartedAt = now` runs BEFORE `resetRepBuffers()`, which then zeroes it. Every REP log shows `durationMs:0`.

**Reference fix:** [src/modules/squat/engine.ts:307-313](src/modules/squat/engine.ts#L307-L313) — reset FIRST, set timestamp AFTER.
```ts
case 'STANDING':
  if (this.smoothedFlexion > DESCEND_START) {
    this.repState = 'DESCENDING';
    this.resetRepBuffers();      // 2026-05-25: must reset FIRST
    this.repStartedAt = now;     // then set repStartedAt
    debugLog('SQUAT', 'STATE', 'STANDING → DESCENDING', { flex: +this.smoothedFlexion.toFixed(1) });
  }
```

### Fix D — Validation reject-reason ordering (rep-based only)
**Problem:** when left/right are wildly asymmetric (e.g. leftPeak=33°, rightPeak=105°), the averaged smoothed-flexion (~42°) reads as `too-shallow` and shadows the real `unilateral` issue.

**Reference:** [src/modules/squat/engine.ts:362-365](src/modules/squat/engine.ts#L362-L365) — `unilateral` check runs BEFORE `too-shallow`. (Skip Fix D for lunge — lunge is intentionally unilateral.)

### Fix E — `TIMER frozen/resumed` debug logs (hold-based only)
Mirror plank's pattern so the user can verify the freeze visually in console:
```ts
if (formBroken && !this.wasFormBroken) {
  debugLog('ENGINE_TAG', 'TIMER', 'frozen', { reason, accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1) });
} else if (!formBroken && this.wasFormBroken) {
  debugLog('ENGINE_TAG', 'TIMER', 'resumed', { accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1) });
}
this.wasFormBroken = formBroken;
```

The `'TIMER'` category is already in `DebugCategory` ([src/lib/debug.ts:35](src/lib/debug.ts#L35)). Each engine's `EngineTag` is also already in the union.

---

## 3. Cross-cutting policies (already shipped, don't break them)

### 3.1 Glossary
Already split into two variants in [src/app/[exerciseId]/report/page.tsx](src/app/[exerciseId]/report/page.tsx):
- `GlossaryRepBased` — for rep-based exercises (Workout accuracy / Score per rep / Depth / Form / Top issue)
- `GlossaryHoldBased` — for hold-based exercises (Workout accuracy / Hold duration / Avg form score / Target met / Top issue)

Each render branch already wires the right one. **No glossary changes needed unless a new exercise introduces a metric** that doesn't fit (e.g. a balance exercise might want "Sway" explained).

### 3.2 Mobile CSS rules
The following responsive patterns are established. Mirror them in any new UI:

| Element | Mobile | sm+ (≥640px) |
|---|---|---|
| Workout-accuracy number | `text-5xl` | `text-7xl` |
| Stat-card padding | `p-2` | `p-4` |
| Stat-card grid gap | `gap-2` | `gap-3` |
| Stat-card label | `text-[11px] leading-tight` | `text-[10px]` |
| Stat-card value | `text-base` | `text-lg` |
| Setup-page input grid | `grid-cols-1` | `grid-cols-3` |
| HoldTimer remaining | `text-6xl` | `text-rest-xxl` (96px) |
| RestCountdown card | `p-4 w-[92vw] max-w-sm` | `p-6 max-w-md` |
| Chart SVG | `w-full h-auto` (always — it's a viewBox SVG) | same |

### 3.3 Chart axis labels
`FormTimeChart` in [src/app/[exerciseId]/report/page.tsx:379](src/app/[exerciseId]/report/page.tsx#L379) now renders x-axis tick labels (`0s / 25%T / 50%T / 75%T / 100%T`) and y-axis tick labels (`0 / 25 / 50 / 75 / 100`) plus axis titles ("Time (seconds)", "Form score"). If you add a new chart, follow the same padding convention: `PAD_L=32, PAD_R=10, PAD_T=10, PAD_B=28`, viewBox `600×160`.

### 3.4 Calibration distance-gate hysteresis
Plank's calibration now uses separate ENTER vs EXIT thresholds for the distance check so small frame jitter doesn't reset the confirmation timer.

**Reference:** [src/modules/plank/calibration.ts:14-22](src/modules/plank/calibration.ts#L14-L22) and [src/modules/plank/calibration.ts:144-160](src/modules/plank/calibration.ts#L144-L160). Mirror this pattern in any calibration layer that has a numeric range gate.

The other 6 calibration layers live at:
- `src/modules/squat/calibration.ts`
- `src/modules/pushup/calibration.ts`
- `src/modules/lunge/calibration.ts`
- `src/modules/bicep-curl/calibration.ts`
- `src/modules/tandem-stand/calibration.ts`
- `src/modules/single-leg-stand/calibration.ts`

Audit each for similar oscillation risk (any check shaped `if (value < THRESHOLD)`). Apply hysteresis ONLY if the value is noisy in practice — don't speculatively add complexity. The user will tell you from physical-test logs which ones thrash.

### 3.5 Instant calibration (round-5 spec)

`CONFIRM_DURATION_MS` is now **200 ms** in both plank and squat ([plank/calibration.ts:10](src/modules/plank/calibration.ts#L10), [squat/calibration.ts:9](src/modules/squat/calibration.ts#L9)) — down from 2000 ms. Per Amir's explicit ask: once all checklist gates turn green, calibration confirms "immediately" and the exercise begins. The 200 ms isn't a UX delay — it's a single ~6-frame debounce to filter MediaPipe single-frame noise (same window as the warning debounce).

**Mirror this in every remaining engine's calibration:** drop their `CONFIRM_DURATION_MS = 2000` to `200`. If any engine has tests that asserted a ~2-2.3 s confirmation window, those tests need to be relaxed — the new window is ~0-500 ms. Look for assertions on `calibrationConfirmedAtMs` and on `CAL_MS = 2200` patterns in the test files.

### 3.6 Distance hints during calibration

Already implemented in plank + squat. The calibration update payload includes `distanceHint: 'too-close' | 'too-far' | null` ([squat/types.ts:41](src/modules/squat/types.ts#L41)) and the play page surfaces it as a banner ([play/page.tsx:552-554](src/app/[exerciseId]/play/page.tsx#L552-L554)).

**Required for every remaining engine:** the calibration must emit a `distanceHint` whenever the body-length-in-frame check fails. The play page already reads this generically — engines just need to populate it. Reference pattern: [src/modules/plank/calibration.ts:150-162](src/modules/plank/calibration.ts#L150-L162).

### 3.7 Idle ("please start exercising") warning — rep-based engines only

Squat fires `not-moving` after **5 seconds** of idle post-calibration ([squat/engine.ts:66](src/modules/squat/engine.ts#L66) — `NO_MOVEMENT_TIMEOUT_MS = 5000`), repeating at most every 15 seconds. The play page maps it to the message "Start moving. Bend your knees to begin." ([play/page.tsx:94](src/app/[exerciseId]/play/page.tsx#L94)).

**Required for every remaining rep-based engine** (pushup, lunge, bicep-curl):
- Track idle frames (smoothed-flexion variance < 2° over a 5 s window)
- Initialize the idle-tracking timer on calibration-confirm (NOT at engine construction — see `13-not-moving-init.test.ts` for the regression that caught this)
- Emit `not-moving` warning at 5 s, repeat at most every 15 s
- Add an exercise-specific message to `WARNING_TEXT` in `play/page.tsx` (e.g., "Start moving. Bend your elbows to begin." for curl)

**Hold-based engines:** do NOT add `not-moving`. For plank/tandem-stand/single-leg-stand, being still IS the exercise. If the user is genuinely doing nothing, the existing `hold-broken` (shoulder rise) or the timeout-retry covers it.

### 3.8 Retry on calibration timeout

When calibration doesn't confirm within `TIMEOUT_MS` (30 s for squat, 20 s for plank), the engine sets `state: 'timeout'`. The play page swaps the live overlay for a centered retry card with a button that recreates the engine ([play/page.tsx:485-510](src/app/[exerciseId]/play/page.tsx#L485-L510), `handleCalibrationRetry` at [play/page.tsx:407](src/app/[exerciseId]/play/page.tsx#L407)).

**Required for every remaining engine:** make sure `state: 'timeout'` is in your CalibrationUpdate union ([squat/types.ts](src/modules/squat/types.ts)), and that the engine sets it when `now - this.startedAt > TIMEOUT_MS`. The play page reads it generically — no per-engine play-page code needed for the retry button to appear.

**Retry mechanism:** the play page bumps an `engineNonce` ([play/page.tsx:405-410](src/app/[exerciseId]/play/page.tsx#L405-L410)) which is in the mount-effect's deps; that recreates the engine instance cleanly. Don't try to "reset" engines in-place — that's harder to get right than tearing down and rebuilding.

---

## 4. Per-engine recipes (5 remaining engines)

Pick ONE. Ship it. Then ship the next.

### 4.1 PUSH-UP — [src/modules/pushup/engine.ts](src/modules/pushup/engine.ts) (rep-based)

| Fix | Action |
|---|---|
| A — warning gating | Gate posture warnings (`hip-sag`, `hip-pike`, `spine-misaligned`) to `repState !== 'TOP'`. Current emission is at ~line 245-247, ungated. |
| B — wrong-rep rejection | Already exists ([engine.ts:344-360](src/modules/pushup/engine.ts#L344-L360)). Verify it emits `malformed-rep` or `incomplete-pushup`. |
| C — durationMs bug | Swap order at ~line 277-278 (TOP → LOWERING). Reset BEFORE setting `repStartedAt`. |
| D — validation order | Move unilateral check BEFORE too-shallow at ~line 321-340. |
| E — TIMER logs | N/A (rep-based). |

State machine: `TOP → LOWERING → AT_BOTTOM → PUSHING → TOP`.

**New regression test:** `tests/scenarios/pushup/05-warning-gating-during-top.test.ts` — mirror of `tests/scenarios/squat/15-warning-gating-during-standing.test.ts`. Hold the user in TOP state with hip-sag injected → assert ZERO warnings. Then run a real rep with hip-sag during DESCEND → assert warnings DO fire.

### 4.2 LUNGE — [src/modules/lunge/engine.ts](src/modules/lunge/engine.ts) (rep-based, unilateral)

| Fix | Action |
|---|---|
| A — warning gating | Gate `valgus` (front knee) and `trunk-forward` to `repState !== 'STANDING'`. Current emission at ~line 207-208. |
| B — wrong-rep rejection | Already exists ([engine.ts:289-326](src/modules/lunge/engine.ts#L289-L326)). |
| C — durationMs bug | Swap order at ~line 240-241 (STANDING → DESCENDING). |
| D — validation order | N/A — lunge is intentionally unilateral, no asymmetry check. |
| E — TIMER logs | N/A. |

State machine: `STANDING → DESCENDING → AT_BOTTOM → ASCENDING → STANDING`.

**New regression test:** `tests/scenarios/lunge/05-warning-gating-during-standing.test.ts`.

### 4.3 BICEP CURL — [src/modules/bicep-curl/engine.ts](src/modules/bicep-curl/engine.ts) (rep-based, bilateral)

| Fix | Action |
|---|---|
| A — warning gating | Gate `torso-swing` and `elbow-drift` to `repState !== 'EXTENDED'`. Current emission at ~line 197-198. |
| B — wrong-rep rejection | Already exists ([engine.ts:295-311](src/modules/bicep-curl/engine.ts#L295-L311)). |
| C — durationMs bug | Swap order at ~line 229-230 (EXTENDED → CURLING). |
| D — validation order | Move unilateral check BEFORE too-shallow at ~line 273-292. |
| E — TIMER logs | N/A. |

State machine: `EXTENDED → CURLING → AT_TOP → LOWERING → EXTENDED`.

**New regression test:** `tests/scenarios/bicep-curl/05-warning-gating-during-extended.test.ts`.

### 4.4 TANDEM STAND — [src/modules/tandem-stand/engine.ts](src/modules/tandem-stand/engine.ts) (hold-based)

| Fix | Action |
|---|---|
| A — warning gating | Already gated to post-baseline-capture ([engine.ts:185-186](src/modules/tandem-stand/engine.ts#L185-L186)). No fix needed. |
| B — wrong-time discard | **Mirror plank's freeze mechanic.** Add `accumulatedValidMs` + `lastFrameAt` + `wasFormBroken` fields. Per frame: if `swaying` warning is sustained, freeze the counter. Exclude `feet-separated` (that breaks the hold entirely, not a coaching cue). |
| C, D | N/A. |
| E — TIMER logs | Add `debugLog('TANDEM', 'TIMER', 'frozen' / 'resumed', ...)` on freeze edges. |

State machine: no rep states — just "waiting for calibration" → "actively holding". Tick math at ~line 202.

**New regression test:** `tests/scenarios/tandem-stand/05-discard-bad-form-time.test.ts` — mirror of `tests/scenarios/plank/05-discard-bad-form-time.test.ts`.

### 4.5 SINGLE LEG STAND — [src/modules/single-leg-stand/engine.ts](src/modules/single-leg-stand/engine.ts) (hold-based)

| Fix | Action |
|---|---|
| A — warning gating | Already gated to post-baseline-capture ([engine.ts:176-177](src/modules/single-leg-stand/engine.ts#L176-L177)). No fix needed. |
| B — wrong-time discard | Mirror plank. Freeze counter on sustained `swaying`. `hip-tilted` is a borderline call — treat as structural (freeze) since a dropped hip means the user's lifted leg has touched ground or near-touched, breaking the unilateral stance. **Confirm with the user before deciding.** |
| C, D | N/A. |
| E — TIMER logs | Add `debugLog('SLS', 'TIMER', ...)`. |

State machine: same as tandem-stand. Tick math at ~line 190.

**New regression test:** `tests/scenarios/single-leg-stand/05-discard-bad-form-time.test.ts`.

---

## 5. Process per engine

For each engine you take on:

1. **Re-read the cited engine + reference implementation** (squat or plank). Don't trust this doc blindly — line numbers drift.
2. **Make ONE engine's edits.** Don't bundle multiple engines into one PR.
3. **Write the regression test** before manually validating.
4. **Run `npx tsc --noEmit`** — must be clean.
5. **Run `npm run test:scenarios`** — must be all green (current baseline: 134).
6. **Update `src/components/glossary` (if applicable)** — only if a new metric appears.
7. **Tell the user it's ready for physical test.** Print the routes they should hit (e.g. `/pushup/setup`).
8. **Wait for their console-log feedback.** Do not start the next engine until they confirm.

---

## 6. What you must NOT do

- ❌ Touch the squat or plank engine. They're field-validated.
- ❌ Bulk-edit all 5 engines in one pass.
- ❌ Add new exercises to the catalog. Out of scope.
- ❌ Refactor the shared report/play/setup pages beyond the targeted polish in §3. Cross-cutting refactors break field-validated engines.
- ❌ Skip writing a test. The test is the only thing that protects against regressions when the user inevitably asks for round 5/6/7 of physical fixes.
- ❌ Use `--no-verify` or skip TypeScript errors. Hard fail = real bug.

---

## 7. Open issues NOT being fixed this round

These are deferred to a future round. Don't fix them speculatively; flag if you encounter them.

- **Plank spine-misaligned threshold (12°) feels too tight.** Warning fires <300ms after hold start in the 2026-05-25 logs. Needs either a wider threshold or a "post-confirmation grace period" where the first ~6-10 frames are excluded from the debounce counter.
- **Calibration thrash on other engines.** Only plank was confirmed via physical-test logs. Squat / pushup / lunge / bicep-curl / tandem-stand / single-leg-stand may or may not have the same distance-gate jitter. Wait for user logs before adding hysteresis.
- **`hold-broken` is a hard terminal in plank.** If the user briefly stands up and re-enters plank, the session is dead. Future round may want to make this recoverable for the first ~1s.
- **Per-set rest countdown timer auto-skips when its parent unmounts.** [RestCountdown.tsx:20-21](src/components/RestCountdown.tsx#L20-L21). Edge case; not currently a user complaint.

---

## 8. Verification recipe

After each engine ships:

```bash
# from C:\Users\Amir Khan\Desktop\kriya-main\kriya-mirror
npx tsc --noEmit                             # must be clean
npm run test:scenarios                       # must be 134 + N (your new tests)
npm run dev                                  # boot dev server
# User opens /<exerciseId>/setup → /<exerciseId>/play
# User pastes console logs back for analysis
```

What to look for in the console logs:

- **Rep-based:** `STANDING → DESCENDING` happens once per rep; every `REP` and `REJECT` line shows `durationMs: <non-zero>`. Between reps, NO heel-lift/valgus/trunk-forward warnings.
- **Hold-based:** `TIMER frozen` always precedes the corresponding warning (or fires alongside it); `TIMER resumed` always follows when form recovers. Final `accumulatedSec` matches what the user perceived they actually held.

---

## 9. Quick file map

```
src/
  modules/
    squat/         engine.ts (round 2 reference) · calibration.ts · scoring.ts · types.ts
    plank/         engine.ts (round 3 reference) · calibration.ts (round 4 reference) · scoring.ts · types.ts
    pushup/        engine.ts · calibration.ts · types.ts
    lunge/         engine.ts · calibration.ts · types.ts
    bicep-curl/    engine.ts · calibration.ts · types.ts
    tandem-stand/  engine.ts · calibration.ts · types.ts
    single-leg-stand/ engine.ts · calibration.ts · types.ts
    pose/          types.ts · facade.ts (MediaPipe wrapper)
  app/[exerciseId]/
    setup/page.tsx   (responsive grid for sets/reps/rest)
    play/page.tsx    (camera + overlay + HoldTimer + RestCountdown)
    report/page.tsx  (workout accuracy + stats + per-set table + warning bars + chart + glossary + actions)
  store/
    workout.ts     (Zustand: sets, holdRecord, recordRep, recordHoldTick, etc.)
  components/
    HoldTimer.tsx
    RestCountdown.tsx
    glossary/        (rep + hold variants live inline in report/page.tsx currently)
tests/
  scenarios/
    squat/ plank/ pushup/ lunge/ bicep-curl/ tandem-stand/ single-leg-stand/
  harness/
    pose-stub.ts   (per-exercise synthesizers)
    runner.ts      (runSquatSession, runPlankSession, etc.)
    types.ts
```

---

**Last updated:** 2026-05-25 by the round-4 session.
