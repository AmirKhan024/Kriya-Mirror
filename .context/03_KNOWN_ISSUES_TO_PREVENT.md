# 03 — Known Issues to Prevent

**This is the most important file in the .context/ folder.** Every bug here was either (a) found by Amir's manager testing his prior 9 mobility/ROM games, or (b) caught in kriya-mirror during the squat/plank build. A new exercise that inherits ANY of these is a regression.

Four sections:
- **A. Manager's recurring patterns** — symptoms seen across 9+ games
- **B. In-house bugs found and fixed during squat/plank build** — code-level traps
- **C. Cross-cutting UX rules (A/B/C)** — must apply to every screen, every chip, every sound
- **D. Manager's 4-step per-exercise workflow** — pick → setup → track → report

---

## A. Recurring patterns from manager's prior-product testing.md

These showed up across **all 9** mobility + ROM games when the manager tested them. The pattern is systematic — every new exercise must address each one.

### A1. No-movement detection missing
**Symptom**: user stands still after calibration, app does nothing. No "start moving" prompt.
**Fix in kriya-mirror**: SquatEngine has `NO_MOVEMENT_TIMEOUT_MS = 12000` + `checkNoMovement()` that fires `not-moving` warning if `repState === 'STANDING'` and flex variance < 2° over 12s.
**Prevent in new exercise**: every engine must implement an idle detector. For hold-based: monitor whether the user even reached calibration-confirmed state, OR whether form score has been ~constant for 12s with no motion (rare for hold but theoretically possible).

### A2. Distance hints not shown during calibration
**Symptom**: calibration silently fails because user is too close or too far, but the UI never says so.
**Fix in kriya-mirror**: SquatCalibration + PlankCalibration both emit `distanceHint: 'too-close' | 'too-far' | null` as a 4th gate, and the play page's calibration overlay shows "Step back" / "Step closer" with body-span ratio.
**Prevent in new exercise**: your calibration MUST include a body-span check with explicit hint emission. Look at `SquatCalibration.checkGates()` — the `distanceOk` boolean + `distanceHint` string.

### A3. "Instructions overlapping" on mobile
**Symptom**: two warnings or instructions overlap on a phone screen, becoming unreadable.
**Fix in kriya-mirror**: **Rule A** (see section C). Single chip on screen at any moment, single pending slot, 3-second display + 1-second gap.
**Prevent in new exercise**: never render multiple chips. Use the existing `currentWarning` slot in play page. Don't add a parallel warning system.

### A4. "Game dashboard cluttered" / fonts too small from 2m away
**Symptom**: user can't read HUD numbers, warning chips, or calibration overlay from where they're standing.
**Fix in kriya-mirror**: **Rule C** (see section C). HUD = 48px desktop / 36px mobile, warnings = 24px bold, rest countdown = 96px. Solid `bg-overlay` backdrop on every camera-overlay element.
**Prevent in new exercise**: when you reuse HUD/HoldTimer/PostureWarningChip/RestCountdown — they already enforce Rule C. If you build a NEW UI element, use the existing token classes (`text-hud-xl`, `text-hud-md`, `text-warning`, `bg-overlay`).

### A5. Audio instructions overlap or cut off mid-sentence
**Symptom**: voice instruction starts, then a new one interrupts before the first finishes — user hears garbled audio.
**Fix in kriya-mirror**: **Rule B** (see section C). `src/lib/audio/voice.ts` has a non-preemptive FIFO queue with max-size-1 pending slot. Only `high`-priority safety messages may interrupt a lower-priority utterance, and even then we wait for a word boundary.
**Prevent in new exercise**: call `speak(text, priority, key)` — don't bypass it. Use `key` to rate-limit same-message repeats (4s cooldown built in).

### A6. Wrong-movement gets counted as a valid rep
**Symptom**: user does a half-rep, a jump, or a one-sided shift — app counts it as a real rep.
**Fix in kriya-mirror**: SquatEngine has `validateRepShape()` with 4 gates: `MIN_REP_DEPTH` (45° minimum), `MIN_REP_DURATION_MS` (300ms minimum), `MAX_HIP_VELOCITY` (rejects ballistic), `MIN_BILATERAL_SYMMETRY` (0.7 ratio).
**Prevent in new exercise**: every rep-based engine needs a `validateRepShape()` step before emitting `onRepComplete`. Reject and emit `malformed-rep` warning so user gets feedback.

### A7. Rest enforcement missing
**Symptom**: user moves during the 5-sec between-set rest, those reps get counted.
**Fix in kriya-mirror**: workout store has explicit `status: 'tracking' | 'resting'` state. `play/page.tsx` resets the engine via `engineRef.current.resetForNextSet()` only when status flips back to tracking — and the engine ignores reps during rest because the state machine doesn't run.
**Prevent in new exercise**: when implementing multi-phase exercises (e.g., bilateral movements with left → rest → right), respect the store's `status` and don't process frames during `resting`.

### A8. Mirroring inconsistencies
**Symptom**: skeleton overlay doesn't match the mirrored camera feed.
**Fix in kriya-mirror**: `play/page.tsx` applies `transform: scaleX(-1)` to BOTH the video and the canvas. The engine reads raw landmarks (un-mirrored) so its logic is unaffected.
**Prevent in new exercise**: don't change the mirroring transform. If your engine reasons about left vs right, it reads `LM.LEFT_*` and `LM.RIGHT_*` as MediaPipe labels them — these are the user's anatomical left/right, not the camera's view.

### A9. "Retake assessment" shows past results
**Symptom**: user finishes a workout, taps "Do another", and the new workout still shows the previous reps on screen.
**Fix in kriya-mirror**: report page's "Do another" link calls `reset()` from the store before navigating. New workout starts with empty state.
**Prevent in new exercise**: always call `reset()` before re-entering a workout flow. Don't store engine-local state outside the engine itself.

### A10. Calibration too hard to pass (no actionable feedback)
**Symptom**: user can't figure out why calibration won't pass. Stares at a checklist that's all red.
**Fix in kriya-mirror**: each gate has a human-readable label that toggles based on its state. Distance hint changes between "Step back", "Step closer", "Good distance". Field tested with Rule C font sizes.
**Prevent in new exercise**: every gate failure must produce an actionable hint. If a gate fails for multiple reasons, pick the most blocking one (Rule A).

### A11. Mobile screen distance fails (works on laptop, breaks on phone)
**Symptom**: developer tested on laptop where everything looks fine; user tries on phone and HUD overflows or buttons are unreachable.
**Fix in kriya-mirror**: HUD has `sm:hidden` mobile-first layout (compact top bar with everything inline) and `hidden sm:block` desktop layout (split cards). Tap targets ≥ 44px. Audio toggle moved to bottom-left to avoid depth-bar collision.
**Prevent in new exercise**: when building a new UI element, test in Chrome devtools mobile emulator (iPhone SE 375×667). Don't use fixed pixel widths greater than 92vw for camera-overlay cards.

---

## B. Bugs found and fixed during kriya-mirror's squat/plank build

These are code-level traps. Future engines will likely hit them again if Claude isn't told.

### B1. Bilateral `&&` shortcut hides extreme asymmetry
**Bug location**: `src/modules/squat/engine.ts` `validateRepShape()`.
**What was wrong**:
```ts
if (this.repPeakLeftKneeDeg > 0 && this.repPeakRightKneeDeg > 0) {
  // ratio check
}
```
If ONE knee never flexes (stays at 0°), this check is skipped — extreme unilateral reps are accepted as valid.
**Fix**:
```ts
const peakSum = this.repPeakLeftKneeDeg + this.repPeakRightKneeDeg;
if (peakSum > 0) {
  const lo = Math.min(this.repPeakLeftKneeDeg, this.repPeakRightKneeDeg);
  const hi = Math.max(this.repPeakLeftKneeDeg, this.repPeakRightKneeDeg);
  if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
}
```
**Prevent in new exercise**: for any bilateral-symmetry check (push-up arms, lunge legs, single-leg poses), use the `peakSum > 0` pattern, not `peakL > 0 && peakR > 0`.

### B2. Plank spine-deviation formula was inverted
**Bug location**: `src/modules/plank/engine.ts`.
**What was wrong**: the formula was `Math.abs(180 - bendDeg)`. When shoulder/hip/ankle are collinear (perfect straight plank), the vector angle between segments is 0° (parallel pointing same direction), so the formula returned `|180 - 0| = 180°` deviation — every perfect plank flagged as severely misaligned.
**Fix**:
```ts
// bendDeg from atan2(cross, dot) — already represents the deviation directly.
// 0 = perfectly parallel (straight spine), 90 = right-angle bend.
const spineDeviation = Math.atan2(cross, dot) * (180 / Math.PI);
```
**Prevent in new exercise**: when measuring "how bent is this joint", start from the vector-angle convention you use. If parallel = straight, then `atan2(cross, dot)` IS the deviation. Don't add `180 - x` unless you've proven the convention requires it.

### B3. SVG filter region collapses to zero for axis-aligned lines
**Bug location**: `src/components/SquatSvg.tsx` and `PlankSvg.tsx`.
**What was wrong**: a `<filter>` defaults to `x="-10%" y="-10%" width="120%" height="120%"` of the element's bounding box. For a perfectly horizontal `<line>` the bounding box has zero height — the filter region collapses to zero — the entire filtered output is clipped away. Vertical lines have the same problem with zero width. Diagonal lines render fine.
**Fix**:
```tsx
<filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="400" height="240">
```
`filterUnits="userSpaceOnUse"` with explicit absolute coordinates makes the filter region independent of the element's bounding box.
**Prevent in new exercise**: every new SVG component with a filter MUST use `filterUnits="userSpaceOnUse"` with explicit coordinates covering the whole viewbox.

### B4. Multi-instance `<defs>` ID collision
**Bug location**: same SVG components rendered multiple times on one page (hero + 3 form-reference cards).
**What was wrong**: every instance had `id="glow-plank"` — multiple `<defs>` with the same ID on one page caused browsers to silently drop filtered output.
**Fix**:
```tsx
const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
const glowId = `pl-glow-${uid}`;
```
**Prevent in new exercise**: every SVG `<filter>`, `<linearGradient>`, `<marker>` ID must be derived from `React.useId()` so each instance is unique.

### B5. Collinear polyline + linejoin + filter = invisible stroke
**Bug location**: original PlankSvg.tsx used a `<polyline>` for the body line.
**What was wrong**: when polyline points are collinear (e.g., shoulder/hip/ankle all at y=100 for a perfect plank), the `strokeLinejoin="round"` join geometry at the middle point becomes degenerate (0° angle). Combined with a filter, some browsers refuse to render the stroke.
**Fix**: use **individual `<line>` elements per segment** instead of a single polyline. Each line has its own well-defined geometry.
**Prevent in new exercise**: never use `<polyline>` for body segments. Always individual `<line>` elements.

### B6. Tailwind defaults ≠ Kriya brand tokens
**Bug location**: was originally throughout `src/components/`.
**What was wrong**: `text-teal-300` is Tailwind's default teal (~#5eead4), not Kriya's brand `#00E5CC`. About 5% off — looks slightly wrong, especially when the app is integrated into kriya-v3-main which uses the brand token.
**Fix**: `tailwind.config.ts` now exposes `accent.teal`, `accent.amber`, `surface`, `muted-foreground` etc. via CSS variables. Components use `text-accent-teal`, `bg-surface-2`, etc.
**Prevent in new exercise**: search every new file for `text-teal-`, `bg-slate-`, `text-amber-` Tailwind defaults and replace with the brand tokens. Never introduce a hex color literal in a `className`.

### B7. Stale DB seed mismatched config names (inherited, future)
**Bug location**: kriya-v3-main's `seed-games.sql` (not a kriya-mirror issue yet — we have no DB).
**Why it's listed**: when the manager eventually integrates kriya-mirror into v3-main, naming and seeds must be kept in sync. The pattern: never assume the seed file is the source of truth; always check the config file.

### B8. Side-view 2D cannot detect elbow flare (push-up)
**Bug location**: `src/modules/pushup/engine.ts` — elbow-flare detection intentionally disabled (`elbowFlaredRaw = false`).
**What was wrong**: a flared elbow in a real push-up sticks out PERPENDICULAR to the body, which projects to side-view 2D as the elbow being nearly UNDER the shoulder (z-direction motion collapses to ~0 horizontal offset). But a STRAIGHT-arm push-up at the top also has the elbow under the shoulder. The two configurations are indistinguishable in 2D from a side camera — the engine's `elbowFlexionDeg(shoulder, elbow, wrist)` reads ~6° (nearly straight) for both. There's no reliable side-view metric.
**Fix in kriya-mirror**: elbow-flare detection is a no-op for the side-camera variant. The `'elbow-flare'` `WarningType` and chip strings exist so a future FRONT-camera push-up variant (which can see the elbow x-offset directly) can re-enable detection without engine changes.
**Prevent in new exercise**: if you find yourself wanting to detect a posture flaw that requires the THIRD axis (depth, z), check whether the user's chosen camera angle actually captures that axis. If not, either (a) require a different camera angle, or (b) accept the limitation and document it clearly. Don't ship false positives.

### B9. Plank's absolute hip-sag baseline breaks when the body moves
**Bug location**: `src/modules/plank/engine.ts` uses `hip.y - baseline.hipY` because plank holds the body at constant height. Mirroring this pattern into push-up caused massive spurious hip-sag warnings.
**What was wrong**: in push-up the WHOLE BODY drops as the rep deepens (shoulder + hip + ankle all lower together). Comparing `hip.y` to a baseline captured at the TOP of the push-up makes the engine think the hips are sagging 0.10+ — far past the 0.04 threshold — every time the user lowers. Same for pike: the body is below baseline even when hips are above the shoulder-ankle line.
**Fix in kriya-mirror**: push-up engine uses a LINE-RELATIVE metric instead:
```ts
const ankleSpanX = ankle.x - shoulder.x;
const expectedHipY = shoulder.y + ((hip.x - shoulder.x) / ankleSpanX) * (ankle.y - shoulder.y);
const hipLineDelta = hip.y - expectedHipY;   // 0 = hip on body line, +X = sag, -X = pike
```
This is invariant to body height changes and isolates true hip-line deviation.
**Prevent in new exercise**: if the body CAN MOVE during the rep (push-up, burpee, lunge), don't reuse plank's absolute baseline. Use the line-relative metric. Plank's pattern is correct only for static-hold exercises where the body stays at the calibration height.

### B10. EMA "init mode" buys ballistic-rep detection one extra frame
**Bug location**: SquatEngine + PushupEngine — the EMA smoother:
```ts
this.smoothedFlexion = this.smoothedFlexion === 0
  ? rawFlexion
  : EMA_ALPHA * rawFlexion + (1 - EMA_ALPHA) * this.smoothedFlexion;
```
**Why it's listed**: the `=== 0` branch causes the smoother to track raw input directly until it becomes nonzero — so the FIRST nonzero frame jumps to the raw value (not the smoothed value). This sets the rep state machine up to enter LOWERING at the same input frame that crosses the threshold, instead of one frame later when the EMA would catch up. For a ballistic rep, this means the smoothed peak hits ~55% of the raw peak instead of ~30% — high enough to exceed `MIN_REP_DEPTH` and reach `completeRep`, where the ballistic-velocity gate then trips. WITHOUT the init shortcut, ballistic reps would be rejected as too-shallow (and emit incomplete-pushup / no malformed-rep) — which would mask the actual ballistic problem from the user.
**Prevent in new exercise**: keep the `=== 0` init branch. It's not just a convenience for the first frame — it's load-bearing for ballistic-rep detection. Use the same MIN_REP_DEPTH × EMA_ALPHA balance as squat (45° / 0.15) or push-up (50° / 0.15) for the dynamics to work; deviating breaks the ballistic gate's edge case.

---

## C. Cross-cutting UX rules

These three rules apply to **every screen, every chip, every sound** in the app. They're enforced by existing components — your job is not to violate them.

### Rule A — one instruction at a time
- **On-screen text**: only one posture-warning chip visible at any moment. No stacking. New warning waits in a single-slot pending queue until the current one finishes (or is replaced by a higher-priority warning).
- **Calibration overlay**: never show two contradictory hints simultaneously. Show the most blocking one first.
- **Cooldown**: 3-second minimum display + 1-second gap before next chip.
- **Implementation**: `currentWarning` state + `pendingWarningRef` in `src/app/[exerciseId]/play/page.tsx`. Don't add a parallel system.

### Rule B — audio never cuts off mid-sentence
- **SpeechSynthesis** queue is FIFO with **non-preemption**. Once an utterance starts, it FINISHES.
- **Drop, don't interrupt**: if a new warning arrives while speaking, drop it unless it's strictly higher priority than what's pending.
- **Only** `high`-priority safety messages may cancel a lower-priority utterance in progress — and even then, wait for the next word boundary.
- **Beep cooldown**: same beep can't trigger twice within 250ms.
- **Implementation**: `src/lib/audio/voice.ts` (`speak()`) + `src/lib/audio/cues.ts` (beeps). Call these, don't bypass.

### Rule C — readable from 2m
- HUD numbers: **48px desktop / 36px mobile**
- Warning chips: **24px bold**
- Calibration overlay text: **24px**, checklist items 18px
- Rest countdown: **96px**
- Every overlay element uses **`.bg-overlay`** (solid `rgba(8,11,19,0.92)` + border + drop shadow) so text reads against any camera background
- Token classes available: `text-hud-xl`, `text-hud-md`, `text-warning`, `text-rest-xxl`, `bg-overlay`, `bg-overlay-danger`, `bg-overlay-amber` (all defined in `tailwind.config.ts` + `src/app/globals.css`)

---

## D. Manager's 4-step per-exercise workflow

From the manager's WhatsApp brief — this is THE camera-vision flow for every exercise:

1. **Set exercise** — user picks from catalog (handled by `/` and `/<id>` routes)
2. **Ask basic** — sets/reps + added weight if strength (rep-based), or target duration (hold-based). Plus safety checks. (handled by `/<id>/setup`)
3. **Track** — sets & reps OR hold duration + live posture guidance via chips (handled by `/<id>/play`)
4. **Report** — sets, reps, accuracy / hold time + form breakdown (handled by `/<id>/report`)

A new exercise must respect all 4 screens. Don't skip steps. Don't add new ones.

---

## Quick recap — what NOT to do

1. ❌ Don't use `<polyline>` for body segments → use individual `<line>` elements (B5)
2. ❌ Don't use a `<filter>` with default region → use `filterUnits="userSpaceOnUse"` (B3)
3. ❌ Don't hardcode SVG `<defs>` IDs → use `useId()` per instance (B4)
4. ❌ Don't use Tailwind defaults like `text-teal-300` → use `text-accent-teal` (B6)
5. ❌ Don't render multiple warning chips → respect the single-slot queue (A3, Rule A)
6. ❌ Don't bypass `speak()` or `playWarningBeep()` → respect the queue/cooldown (A5, Rule B)
7. ❌ Don't ship without scenarios → write 5+ tests under `tests/scenarios/<id>/` (also catches B1, B2 patterns)
8. ❌ Don't use small fonts on camera overlays → use the `text-hud-*` / `text-warning` tokens (A4, Rule C)
9. ❌ Don't `&&`-gate a bilateral check → use `peakSum > 0` (B1)
10. ❌ Don't forget the distance gate in calibration → emit `distanceHint` like squat/plank do (A2)
11. ❌ Don't accept a rep without `validateRepShape()` → reject ballistic / shallow / unilateral (A6)
12. ❌ Don't add a new engine without an idle detector → 12s no-movement timeout (A1)
