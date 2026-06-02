# Reusable bootstrap prompt for fresh Claude Code sessions

> **How to use this file**: when you start a new Claude Code session (because the previous one ran out of context), copy everything below the line, paste it into the session as your first message, attach `kriya-mirror-fitness-library.md`, and fill in your task at the bottom. This prompt is intentionally generic so you can reuse it for every future session.

---

You're helping me continue work on **Kriya Mirror** — a Next.js camera-vision fitness coaching app I'm building incrementally.

## Project location

```
C:\Users\Amir Khan\Desktop\kriya-main\kriya-mirror\
```

## Read in this order BEFORE doing anything (5 minutes total)

1. `CLAUDE.md` — auto-loaded orientation
2. `.context/00_START_HERE.md` — who I am, current state, how I communicate
3. `.context/01_ARCHITECTURE.md` — code structure, ExerciseConfig + ExerciseEngine patterns
4. `.context/02_EXERCISE_CHECKLIST.md` — 12-step recipe for adding any new exercise
5. `.context/03_KNOWN_ISSUES_TO_PREVENT.md` — bugs already fixed (manager's testing + in-house). **Don't repeat any of these.** This is the most important file.
6. `.context/04_DEBUGGING_AND_TESTING.md` + `DEBUGGING.md` — debug-log workflow + automated scenario pipeline
7. `.context/05_DESIGN_RULES.md` — color tokens, font sizes, layout patterns

Once you've read these, briefly confirm what you understood (one sentence per file is plenty). Then proceed.

## Source folders (outside this repo, biomechanic reference only)

```
C:\Users\Amir Khan\Desktop\kriya-activities\range_of_motion_bilal_me\range_of_motion_new\   (4 ROM games — vanilla JS)
C:\Users\Amir Khan\Desktop\kriya-activities\mobility_new\                                   (5 mobility games — vanilla JS)
```

These are MY original implementations of similar exercises. The kriya-mirror engines are TypeScript ports of these. When designing a new exercise, look at the source folder for biomechanic constants (e.g., `MIN_REP_DEPTH`, joint-angle thresholds, debounce frames).

## Currently shipped in kriya-mirror

- **Bodyweight Squat** (rep, front camera) — `src/modules/squat/`
- **Plank** (hold, side camera) — `src/modules/plank/`
- **Push-Up** (rep, side camera) — `src/modules/pushup/`
- **Forward Lunge** (rep, front camera, unilateral) — `src/modules/lunge/`
- **Tandem Stand** (hold, front camera, Balance — introduces CoM-proxy sway-score per BB5 clinical spec) — `src/modules/tandem-stand/`
- **Bicep Curl** (rep, front camera, **first B/Isolation**) — `src/modules/bicep-curl/`
- **Single Leg Stand** (hold, front camera, Balance — K1; reuses Tandem's sway infra + adds hip-tilt detection) — `src/modules/single-leg-stand/`
- Shared `HeroIllustration` component routes `svg:<id>` to the matching SVG (so future hero adds are one file, not two surfaces)
- Debug logging + 122 passing scenarios in `tests/scenarios/`
- Tailwind tokens, Rule A/B/C enforcement, YouTube video embed, privacy badge

## Attached

`kriya-mirror-fitness-library.md` — the full spec for all 274 planned exercises (17 categories, 3 delivery modes each, MediaPipe verdict per exercise).

## Hard rules — non-negotiable

1. **Don't break any of the 7 shipped engines** (Squat, Plank, Push-Up, Forward Lunge, Tandem Stand, Bicep Curl, Single Leg Stand). They're shipped, hardened, and have a 122-scenario test suite. Run `npm run test:scenarios` periodically to confirm nothing regressed.
2. **Write scenario tests BEFORE manual browser testing.** Every new exercise gets 5+ scenarios under `tests/scenarios/<id>/`. Both real engine bugs in kriya-mirror's history were caught by tests, not browser testing.
3. **Follow Rule A / B / C** (detailed in `03_KNOWN_ISSUES_TO_PREVENT.md`):
   - Rule A: one chip on screen at a time
   - Rule B: audio never cuts off mid-sentence
   - Rule C: readable from 2m (use `text-hud-xl`, `text-warning`, `bg-overlay` tokens)
4. **Mirror the templates**: copy squat for rep-based, plank for hold-based. Don't invent new architectures.
5. **Sprinkle `debugLog` at every state change** — `import { debugLog } from '@/lib/debug';` then `debugLog('PUSHUP', 'STATE', 'STANDING → DESCENDING', { ... })`. The whole point is that the browser console tells me immediately what the engine saw.
6. **In any new SVG component**: use `React.useId()` for all `<defs>` IDs and `filterUnits="userSpaceOnUse"` on every `<filter>`. Use individual `<line>` elements for body segments, never `<polyline>`. Three known bugs caught me here.
7. **Use design tokens** (`text-accent-teal`, `bg-surface-2`, `text-muted-foreground`) — never Tailwind defaults like `text-teal-300`.
8. **Three-place edit for a new exercise**: config file + `src/config/exercises/index.ts` export + engine routing in `src/app/[exerciseId]/play/page.tsx`. Forget any one and the exercise won't load.

## Workflow

1. Read the 7 context files.
2. Plan the new exercise (1–2 sentences: type, camera angle, primary metric, posture warnings to detect).
3. Implement following `02_EXERCISE_CHECKLIST.md` step by step.
4. Write 5+ scenarios under `tests/scenarios/<id>/`.
5. Run `npm run test:scenarios` and `npx tsc --noEmit` until both are clean.
6. Update `CLAUDE.md` + `PROMPT.md` "Currently shipped" lists with the new exercise.
7. Hand back to me with a 2-sentence summary + the dev-server command to test in browser.

## About me

I'm a vibe-coder. I don't read TypeScript fluently. I prefer:
- **Direct answers, not options** — decide and tell me
- **Short sentences** — I read fast
- **File paths with line numbers** when relevant
- **Terminal commands** I can paste, not "you'll need to install X first..."
- **2-sentence summaries** after edits, not essays

## Your task



read the attached .md file
since squat and plank is made, move on to next phase which yoiu think its right 

after selecting what to build, give me a dialog box to put yoututbe url then you will wire it also 
also if possible try to build more than 1 exrcsie in this IF AND ONLY IF ITS POSSIBLE OTHERWISE DONT . this is very serious, if you think you can build more than 1 game without quality reducing or without any error seamless development, then only move on creaet more than 1 exercise based on your full quality capacity 
otherwise just stick to one exercise development 

i dont want new error to introduce if you are createing mroe than 1 exericse as there is a higher chance of yoiu messing up 
but if you think you can build more than 1 exercise at once without messing up and no error then its very good.

## 

Build mode: SEQUENTIAL-SAFE.

Pick the next exercise based on the .md spec. After deciding, prompt me with a
dialog-style line asking for the YouTube URL (one-liner I can paste a link to)
before you start coding.

If — AND ONLY IF — the next obvious-best pick has a SAME-TEMPLATE sibling
(both rep-based front-camera, OR both rep-based side-camera, OR both
hold-based, sharing pose-stub geometry), you may build TWO in this prompt.
Otherwise build ONE.

Quality gate (mandatory whether 1 or 2):
- Write each exercise's 5+ scenarios FIRST, watch them fail, then implement
  the engine until they pass. Don't write engine then scaffold tests around it.
- After exercise A is complete and `npm run test:scenarios` is green, ONLY
  THEN start exercise B. Never write both in parallel — too easy to merge bugs.
- Final check: `npm run test:scenarios` (all green, including squat + plank
  regressions) + `npx tsc --noEmit` clean before handing back.

If at any point during exercise B you hit a new bug that wasn't in the
known-issues file, STOP exercise B, ship exercise A only, and add the new
bug to .context/03_KNOWN_ISSUES_TO_PREVENT.md so the next session is warned.

When you ask for the YouTube URL, ask for BOTH if you're building 2 — one
per exercise. Format your ask so I can paste two URLs in two lines.