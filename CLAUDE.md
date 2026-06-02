# Kriya Mirror — Project Orientation (auto-loaded by Claude Code)

**What this is** — a Next.js 14 + TypeScript camera-vision fitness coaching app. User opens the camera, picks an exercise, the app watches their form via MediaPipe pose detection, counts reps, scores alignment, and coaches them live. Target catalog: 274 exercises across 17 categories. Currently shipped: **Squat** (rep, front), **Plank** (hold, side), **Push-Up** (rep, side), **Forward Lunge** (rep, front, unilateral), **Tandem Stand** (hold, front, Balance), **Bicep Curl** (rep, front, Isolation), **Single Leg Stand** (hold, front, Balance — K1, reuses Tandem's sway infra + adds hip-tilt detection).

User: **Amir** — vibe-coder, doesn't read TypeScript fluently. Wants surgical edits, not refactors. Prefers to test in browser → copy console → paste back for bugfixes.

---

## Read these before doing anything

| If you need to… | Open |
|---|---|
| Get oriented in 2 minutes | [.context/00_START_HERE.md](./.context/00_START_HERE.md) |
| Understand the code structure | [.context/01_ARCHITECTURE.md](./.context/01_ARCHITECTURE.md) |
| Add a new exercise (step-by-step) | [.context/02_EXERCISE_CHECKLIST.md](./.context/02_EXERCISE_CHECKLIST.md) |
| **Avoid bugs already found and fixed** | [.context/03_KNOWN_ISSUES_TO_PREVENT.md](./.context/03_KNOWN_ISSUES_TO_PREVENT.md) |
| Use the debug logs + scenario test pipeline | [.context/04_DEBUGGING_AND_TESTING.md](./.context/04_DEBUGGING_AND_TESTING.md) → [DEBUGGING.md](./DEBUGGING.md) |
| Match the design system (fonts, colors, layout) | [.context/05_DESIGN_RULES.md](./.context/05_DESIGN_RULES.md) |

---

## Hard rules

1. **Don't break any of the 7 shipped engines** (Squat, Plank, Push-Up, Forward Lunge, Tandem Stand, Bicep Curl, Single Leg Stand) — they're shipped, tested (122-scenario suite), and reflect 10+ hours of hardening work.
2. **Three-place edit for a new exercise**: config file + `src/config/exercises/index.ts` export + engine routing in `src/app/[exerciseId]/play/page.tsx`. Forget any one and the exercise won't load.
3. **Rule A** (one chip at a time, no overlap), **Rule B** (audio never cuts off mid-sentence), **Rule C** (readable from 2m). Details in `03_KNOWN_ISSUES_TO_PREVENT.md`.
4. **Tokens, not Tailwind defaults** — use `text-accent-teal`, `bg-surface-2`, `text-muted-foreground`. Never `text-teal-300`, `bg-slate-800`, etc.
5. **Test before browser-test** — every new exercise gets 5+ scenarios under `tests/scenarios/<id>/` and passes `npm run test:scenarios` before manual testing.
6. **Every state change gets a debug log** — `debugLog('SQUAT', 'STATE', '...')`. The whole point of the logging infrastructure is that the browser console tells you immediately what the engine saw.

---

## Quick commands

```powershell
cd C:\Users\Amir Khan\Desktop\kriya-main\kriya-mirror
npm run dev                    # http://localhost:3000
npm run test:scenarios         # run all 122 automated tests (~1 second)
npm run test:scenarios:watch   # auto-rerun on change
npx tsc --noEmit              # type check
```

---

## Source folders for biomechanical reference (outside this repo)

When designing a new exercise's geometry / scoring, look at how Amir solved similar movement in his vanilla-JS source:

- `C:\Users\Amir Khan\Desktop\kriya-activities\range_of_motion_bilal_me\range_of_motion_new\` (Shoulder Sunrise, Neck Compass, Hip Hinge Arc, Windmill Reach)
- `C:\Users\Amir Khan\Desktop\kriya-activities\mobility_new\` (Hip Gate, Spinal Wave, Deep Squat, Lateral Flexion, Cossack Squat)

Treat these as the canonical spec for thresholds and audit history. The kriya-mirror engines are TypeScript ports of these.
