# 00 — Start Here

## Who you're helping

**Amir** — vibe-coding on Windows 11. Doesn't read TypeScript fluently. Workflow:
1. Asks Claude to add an exercise / fix a bug
2. Tests in browser
3. If something's wrong, copies DevTools console → pastes back to Claude
4. Expects Claude to identify the bug from the logs and fix it surgically

Default to small, focused changes. Don't refactor existing engines unless asked. Don't add architectural ceremony. The goal is shipping more exercises, not building a perfect framework.

## What kriya-mirror is

A camera-vision fitness app. User picks an exercise from the catalog, opens the camera, gets live coaching. Powered by MediaPipe pose detection (33 body landmarks).

- Spec: `kriya-mirror-fitness-library.md` (in Amir's Downloads, attached to most sessions)
- 274 exercises planned across 17 categories
- 3 delivery modes per exercise: 📸 Image+Text · 🎬 Video+Audio · 📷 Camera Vision
- Manager's WhatsApp workflow per exercise: **pick → setup (weight if strength) → track sets/reps + posture correction → report**

## Where it lives

```
C:\Users\Amir Khan\Desktop\kriya-main\
├── kriya-v3-main\            (manager's product — different codebase)
└── kriya-mirror\             (THIS project)
    ├── CLAUDE.md             (auto-loaded entry)
    ├── PROMPT.md             (reusable bootstrap for fresh sessions)
    ├── DEBUGGING.md          (browser console + test pipeline)
    ├── .context\             (numbered deep-dive docs — you're reading file 00)
    ├── src\                  (Next.js code)
    ├── tests\                (vitest scenarios, ~1 second to run all)
    └── public\
```

Source folders Amir authored (outside this repo, reference only):
- `kriya-activities\range_of_motion_bilal_me\range_of_motion_new\` (4 ROM games)
- `kriya-activities\mobility_new\` (5 mobility games)

Those are vanilla-JS, the canonical biomechanic spec. Mirror their thresholds when adding similar exercises.

## Current state

- ✅ **Bodyweight Squat** (rep-based, front camera) — `src/modules/squat/`
- ✅ **Plank** (hold-based, side camera) — `src/modules/plank/`
- ✅ Debug logging via `src/lib/debug.ts` — toggle in DevTools: `localStorage.KRIYA_DEBUG_LEVEL = 'verbose'`
- ✅ Test pipeline: 34 scenarios passing in ~1 second (`npm run test:scenarios`)
- ✅ Design tokens aligned with kriya-v3-main (`accent-teal`, `surface`, `muted-foreground`, etc.)
- ✅ Rule A/B/C enforcement in play-page UI
- ✅ Privacy badge on landing + every setup screen
- ✅ YouTube video embed support for 🎬 Video+Audio mode

## What's next

The user will tell you what they want — most likely "add the Push-Up exercise" or "add Lunge + Glute Bridge". Read [02_EXERCISE_CHECKLIST.md](./02_EXERCISE_CHECKLIST.md) for the step-by-step. Read [03_KNOWN_ISSUES_TO_PREVENT.md](./03_KNOWN_ISSUES_TO_PREVENT.md) so you don't recreate any of the 7 bugs already squashed during squat/plank development.

## Communication style

- Amir wants **direct answers**, not options. Decide and tell him.
- Use **shorter sentences** — he reads quickly.
- Reference **file paths** when explaining where things live (he uses VS Code links).
- Show **terminal commands** for him to run — don't assume he'll figure them out.
- After a code change, say what changed in 2 sentences. Don't write essays.

## When in doubt

Read more of the `.context/` files. They're short and specific. The whole `.context/` folder reads in ~10 minutes and covers everything you need.
