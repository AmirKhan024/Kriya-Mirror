# Kriya Mirror

**An AI camera-vision fitness coach that runs entirely in your browser.**

Kriya Mirror turns any laptop webcam into a personal form coach. Pick an exercise, turn on your camera, and the app uses on-device pose detection to count your reps, score your form in real time, and call out posture mistakes as they happen — all without a single frame ever leaving your machine.

---

## Highlights

- **39 live guided exercises** (40 modules) — from Bodyweight Squat, Plank, and Push-Up to Warrior poses, Cossack Squat, Cat-Cow, and Single Leg Stand.
- **Real-time coaching** — live rep counting, hold timers, form/depth/alignment scoring, and spoken cues.
- **On-device & private** — pose detection runs locally via MediaPipe; the camera feed never leaves the browser. No backend, no account, no upload.
- **Per-exercise analytics** — a post-workout report with accuracy, per-set breakdowns, posture-issue charts, and form-over-time graphs.
- **Tested before the browser** — 300+ scenario tests drive the real engines through simulated poses, so form logic is verified without ever opening a camera.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict) |
| Pose / vision | MediaPipe Tasks Vision (33-landmark pose detection) |
| State | Zustand |
| Styling | Tailwind CSS + custom design tokens |
| Testing | Vitest (scenario + unit) |

## Architecture

Every exercise is a **self-contained module**, which keeps the app easy to extend and hard to break:

```
src/
├── app/[exerciseId]/        # detail · setup · play (camera+HUD) · report
├── config/exercises/        # one <id>.config.ts per exercise + registry index.ts
├── modules/<id>/            # per-exercise engine: geometry · calibration · scoring · state machine
│   ├── engine-interface.ts  # shared contract every engine implements
│   ├── pose/                # MediaPipe pose detection
│   └── camera/              # camera manager
├── store/                   # Zustand workout state
└── lib/                     # audio cues, debug logging, helpers
tests/
├── harness/                 # pose builders + session runners (no DOM needed)
├── scenarios/<id>/          # per-exercise behaviour tests
└── unit/
```

Adding an exercise is a three-place change: a config file, a registry entry, and an engine-dispatch line — plus its own scenario tests.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), pick an exercise, and allow camera access.

## Testing

```bash
npm run test:scenarios        # run all scenario tests
npm run test:scenarios:watch  # watch mode
npm run test:squat            # a single exercise suite
```

## How it works

1. **Calibrate** — a short setup wizard checks framing, distance, and orientation.
2. **Detect** — MediaPipe returns 33 body landmarks per frame.
3. **Measure** — per-exercise geometry turns landmarks into joint angles and distances.
4. **Score** — completion, form, and smoothness blend into a per-rep quality score.
5. **Coach** — one cue at a time, readable from two metres away, never cutting off mid-sentence.
6. **Report** — every set is summarised with accuracy and the most common posture issues.

---

*Built with a test-first workflow: every exercise ships with scenario coverage before it ever reaches a real camera.*
