# 05 — Design Rules

## Color palette (matches kriya-v3-main exactly)

| Purpose | Hex | Tailwind token |
|---|---|---|
| Background | `#0A0E17` | `bg-background` |
| Surface (cards) | `#131A2B` | `bg-surface` |
| Surface 2 (inputs) | `#1a2435` | `bg-surface-2` |
| Surface 3 (borders) | `#243049` | `border-surface-3` |
| Foreground (text) | `#f8fafc` | `text-foreground` |
| Muted (labels) | `#5a6b80` | `text-muted` |
| Muted-foreground | `#8fa3b8` | `text-muted-foreground` |
| Accent — teal (primary CTA) | `#00E5CC` | `bg-accent-teal`, `text-accent-teal` |
| Accent — teal hover | `#00CFB8` | `bg-accent-teal-hover` |
| Accent — teal soft (chip bg) | `rgba(0,229,204,0.12)` | `bg-accent-teal-soft` |
| Accent — teal border | `rgba(0,229,204,0.28)` | `border-accent-teal-border` |
| Accent — amber (warning) | `#FFB547` | `text-accent-amber`, `bg-accent-amber-soft` |
| Accent — danger (red) | `#FF4D6A` | `text-accent-danger`, `bg-accent-danger-soft` |

**Never** use raw Tailwind defaults (`text-teal-300`, `bg-slate-800`, `text-red-400`, etc.) in components. They're close to the brand but ~5% off and break the design when the app is integrated into kriya-v3-main. See `03_KNOWN_ISSUES_TO_PREVENT.md` bug B6.

CSS variables live in `src/app/globals.css`. Tailwind aliases in `tailwind.config.ts`.

---

## Typography

Fonts (loaded via Google Fonts CDN in `layout.tsx`):
- **Inter** — body text (`font-sans`)
- **Space Grotesk** — headings (`font-heading`)

Font-size tokens defined in `tailwind.config.ts` — use these on overlay elements, NOT raw `text-xl` / `text-2xl`:

| Token | Size | Use |
|---|---|---|
| `text-hud-xl` | 48 px (bold) | HUD numbers on desktop (Set/Rep counter, MQS) |
| `text-hud-md` | 36 px (bold) | HUD numbers on mobile |
| `text-warning` | 24 px (bold) | Warning chip text, calibration overlay instruction |
| `text-rest-xxl` | 96 px (extra-bold) | Rest countdown timer |

Standard Tailwind sizes (`text-sm`, `text-base`, `text-xl`) are fine for catalog cards, exercise detail body, report tables — anything NOT viewed from 2m.

---

## Overlay backdrop classes (`globals.css`)

Every camera-overlay element MUST use one of these — solid 92% opacity + border + drop shadow so text reads against any background:

| Class | When |
|---|---|
| `bg-overlay` | Default. HUD cards, calibration overlay, audio toggle. |
| `bg-overlay-amber` | Amber/normal-priority warning chips. |
| `bg-overlay-danger` | Red/urgent warning chips, error states. |

Defined in `src/app/globals.css` `@layer utilities`. Don't use `bg-slate-900/70` or other one-off opacity values.

---

## Card pattern

Catalog cards (`src/components/CatalogCard.tsx`) are **deliberately stripped down** — Amir explicitly removed jargon:
- ❌ No "100% trackable" badge
- ❌ No catalog code ("A1 / C2")
- ❌ No mode icons (📸 🎬 📷) on the card
- ❌ No "Architected for 274 exercises..." marketing text
- ❌ No "MediaPipe verdict" section

Only show: **name + difficulty + 2 primary muscles**. Mode icons appear on the detail page tabs, not on cards.

---

## Mode tab pattern

`src/components/ModeTabs.tsx` — 3 tabs at top of detail page:

| Tab | Always enabled | Disabled when |
|---|---|---|
| 📸 Image + Text | yes (every exercise) | — |
| 🎬 Video + Audio | when `videoUrl` is in the config OR user has pasted one | otherwise still shown with "no video added yet" CTA |
| 📷 Camera Vision | when `guidanceModes.cameraVision !== 'none'` | when MediaPipe can't track the movement (e.g., swimming, breathwork) |

Disabled tabs render as muted, non-clickable.

---

## Image / illustration pattern

Three options for the hero image, in order of preference:

1. **SVG component** (preferred for repeatable exercises) — file: `src/components/<Id>Svg.tsx`. Hero id is `'svg:<id>-hero'` in the config. See SquatSvg / PlankSvg for the template. **Must use `useId()` + `filterUnits="userSpaceOnUse"` + individual `<line>` elements** (see `03_KNOWN_ISSUES_TO_PREVENT.md` bugs B3, B4, B5).
2. **Copied PNG/JPG** (when source kriya-activities folder has matching art) — drop into `public/exercises/<id>/` and reference as `'/exercises/<id>/file.png'`.
3. **No image yet** — fine for early-stage configs. Just use a placeholder or leave the image as the SVG.

Wire SVG components into `ImageTextMode.tsx`'s `HeroIllustration()` function AND `setup/page.tsx`'s hero render block.

---

## Privacy badge placement

Two variants of `<PrivacyBadge>`:
- **Compact pill** on the landing page header — "🔒 Your camera stays on your device..."
- **Full card** on every exercise's setup page (right above the safety check) — reassures the user just before the camera turns on

When adding a new exercise, the setup page inherits this automatically because it's part of the shared setup template. Don't remove it.

---

## Audio cues + voice (`src/lib/audio/`)

The cue catalog (`cues.ts`) covers every workout milestone:
- `playCalibrationBeep` (800 Hz) — on calibration confirmed
- `playGoBeep` (600 Hz) — fires after calibration, before first rep
- `playRepComplete` (1000 Hz) — every rep
- `playSetComplete` (800 → 1200 Hz dual) — end of set / end of hold
- `playWarningBeep` (400 Hz square) — any posture warning
- `playRestStart` (500 → 700 then 600 → 900 sliding) — rest screen

All gated by `localStorage.kriya-mirror:audio:sound-muted` (via `AudioToggle`). Same-sound cooldown 250ms prevents stomping (Rule B).

Voice (`voice.ts`) — non-preemptive FIFO queue, max-size-1 pending slot. See bug A5 in `03_KNOWN_ISSUES_TO_PREVENT.md`.

When adding a new exercise: call existing functions, don't add new beep tones unless absolutely necessary (and add a cooldown if you do).

---

## Layout — desktop vs mobile

| Breakpoint | Behavior |
|---|---|
| `< sm` (mobile, < 640px) | HUD becomes a single compact top bar. Audio toggle bottom-left. Warning chip bottom-44. |
| `>= sm` (desktop) | HUD splits into top-left MQS card + top-right Set/Rep card. Audio toggle bottom-left. Warning chip bottom-32. |

Tap targets ≥ 44px everywhere. Test in Chrome devtools mobile emulator (iPhone SE 375×667) before shipping.

---

## Animation

Defined in `tailwind.config.ts`:
- `animate-fade-up` — appear elements
- `animate-slide-in-up` — warning chips entering from below

Don't add new animations unless they serve a UX function. No decorative animations.
