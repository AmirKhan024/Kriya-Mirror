# Kriya Mirror — Master Fitness Library
### Complete Exercise Reference, Tracking Specifications & MediaPipe Verdict

> **Document purpose:** This is the definitive fitness library for Kriya Mirror — covering every exercise category, full movement instructions, tracking fields, posture error detection, three guidance modes, and a MediaPipe (BlazePose) compatibility verdict for camera-vision tracking.

---

## Part 1 — Three Guidance Modes in Kriya Mirror

Every exercise in this library is tagged for which of three delivery modes it supports.

| Mode | Description | Best For |
|---|---|---|
| **📸 Image + Text** | Step-by-step still photos with written cues, common error callouts, breathing pattern | Quiet environments, accessible on low bandwidth, self-paced learning |
| **🎬 Video + Audio** | Motion video demonstration + voiceover coaching cues synced to movement | Visual learners, new exercises, when form needs to be seen in motion |
| **📷 Camera Vision** | MediaPipe pose estimation overlays on live camera. Tracks joint angles, depth, alignment, rep count, posture errors in real time | Home/gym use, solo training, when a coach is not available |

---

## Part 2 — MediaPipe BlazePose — What It Can Detect

MediaPipe BlazePose detects **33 body landmarks** in real time from a single RGB camera. From these, Kriya can compute:

### Detectable landmarks
```
Head:       Nose (0), Left/Right Eye (1–4), Left/Right Ear (7–8)
Upper body: Left/Right Shoulder (11–12), Left/Right Elbow (13–14)
            Left/Right Wrist (15–16)
Torso:      Left/Right Hip (23–24)
Lower body: Left/Right Knee (25–26), Left/Right Ankle (27–28)
            Left/Right Heel (29–30), Left/Right Foot Index (31–32)
```

### Computed metrics from landmarks
| Metric | How | Example |
|---|---|---|
| Joint angle | Vector angle between 3 landmarks | Knee angle in squat = hip–knee–ankle |
| Segment alignment | Angle of segment vs vertical/horizontal | Back angle in deadlift |
| Symmetry | L vs R landmark Y-position difference | Shoulder levelness |
| Range of motion | Max – min angle across a set | Full depth squat ROM |
| Rep count | Cycles crossing an angle threshold | Squat: knee < 90° = bottom, > 160° = top |
| Posture deviation | Angle vs ideal reference | Forward head posture |
| Balance / sway | Hip landmark drift from centre over time | Tree pose stability |
| Velocity | Landmark displacement per frame | Explosive jump height |

### MediaPipe Verdict Key
| Symbol | Verdict | Meaning |
|---|---|---|
| ✅ **100%** | Full Camera Vision | All critical joints visible, angles computable, rep counting reliable |
| ⚠️ **Partial** | Limited tracking | Some joints hidden, or movement axis not captured from standard camera angle |
| ❌ **Not trackable** | No Camera Vision | Body occluded, underwater, inside machine, or movement too subtle to detect |

---

## Part 3 — Complete Exercise Library

---

# 🏋️ CATEGORY A — STRENGTH: COMPOUND MOVEMENTS

*Multi-joint exercises engaging two or more large muscle groups simultaneously. The foundation of any strength programme.*

---

### A1 — Back Squat

| Field | Detail |
|---|---|
| **Equipment** | Barbell + rack / Dumbbell / Bodyweight |
| **Primary Muscles** | Quadriceps, Glutes, Hamstrings |
| **Secondary** | Erector Spinae, Core, Adductors |
| **Difficulty** | Intermediate |
| **Track** | Sets, Reps, Load (kg), Depth (parallel / ATG), Tempo |

**Step-by-step Instructions:**
1. Unrack bar on upper traps (high bar) or rear delts (low bar). Feet shoulder-width, toes 15–30° out.
2. Take a big breath into belly (Valsalva). Brace core 360°.
3. Initiate descent by pushing knees out over toes. Break at hips and knees simultaneously.
4. Lower until thighs are parallel to floor minimum. Maintain neutral spine throughout.
5. Drive through mid-foot, extend hips and knees simultaneously back to standing.
6. Exhale at the top.

**Common Errors & Camera Detection:**
- ❌ Knees caving inward (valgus collapse) — MediaPipe detects knee-to-foot alignment
- ❌ Heels rising — ankle landmark vs floor plane
- ❌ Excessive forward lean (torso angle > 45°) — hip-shoulder angle calculation
- ❌ Butt wink (pelvic tuck at bottom) — hip landmark vs lumbar curve
- ❌ Shallow depth — hip landmark height vs knee height

**Breathing:** Inhale & brace before descent → hold through sticking point → exhale at top

**Modifications:**
- Easier: Goblet squat, box squat, bodyweight squat
- Harder: Pause squat (2–3s bottom), tempo squat (3-1-1), Bulgarian split squat

**Guidance Modes:** 📸 ✅ | 🎬 ✅ | 📷 ⚠️ Partial *(back angle hard to track without side camera; front camera can detect knee valgus, depth. Barbell not tracked.)*

**MediaPipe Verdict:** ⚠️ Partial — Best with side-facing camera. Tracks depth, knee tracking, symmetry. Cannot track bar position or load.

---

### A2 — Conventional Deadlift

| Field | Detail |
|---|---|
| **Equipment** | Barbell / Dumbbells / Resistance band |
| **Primary Muscles** | Hamstrings, Glutes, Erector Spinae |
| **Secondary** | Quads, Traps, Core, Forearms |
| **Difficulty** | Intermediate |
| **Track** | Sets, Reps, Load (kg), Hip hinge angle, Lockout quality |

**Step-by-step Instructions:**
1. Stand with feet hip-width. Bar over mid-foot (if barbell). Grip just outside legs.
2. Hip hinge: push hips back, chest tall, neutral spine. Shoulders slightly in front of bar.
3. Take full breath, brace hard. Engage lats ("protect your armpits").
4. Drive floor away (leg press the floor). Bar stays in contact with shins.
5. Hips and shoulders rise at the same rate — don't let hips shoot up first.
6. Lock out: squeeze glutes, stand tall. Do not hyperextend lower back.
7. Reverse: hip hinge back to floor. Maintain tightness throughout.

**Common Errors & Camera Detection:**
- ❌ Rounded lower back — shoulder-to-hip angle + torso angle at initiation
- ❌ Hips shooting up first (stiff-leg deadlift pattern) — hip vs shoulder landmark timing
- ❌ Bar drifting away from body — not trackable (bar position)
- ❌ Not achieving full lockout — hip extension angle at top
- ❌ Hyperextension at lockout — lumbar curvature (partial inference)

**Breathing:** Full inhale + brace → hold entire lift → exhale after lockout

**Modifications:**
- Easier: Romanian Deadlift, Trap bar deadlift, Dumbbell deadlift
- Harder: Deficit deadlift, Pause deadlift, Single-leg deadlift

**Guidance Modes:** 📸 ✅ | 🎬 ✅ | 📷 ⚠️ Partial *(side camera required for hip hinge quality; front camera detects shoulder symmetry)*

**MediaPipe Verdict:** ⚠️ Partial — Side camera essential. Tracks hip hinge angle, lockout quality, torso position.

---

### A3 — Bench Press (Flat)

| Field | Detail |
|---|---|
| **Equipment** | Barbell + bench / Dumbbells / Resistance band |
| **Primary Muscles** | Pectoralis Major, Anterior Deltoid, Triceps |
| **Secondary** | Serratus Anterior, Core (stability) |
| **Difficulty** | Intermediate |
| **Track** | Sets, Reps, Load (kg), Range of motion, Arch |

**Step-by-step Instructions:**
1. Lie flat on bench. Eyes under bar (if barbell). Retract shoulder blades and depress. Slight natural arch in lower back.
2. Grip slightly wider than shoulder-width. Thumbs around bar.
3. Unrack with straight arms. Lower bar with control to lower chest / nipple line.
4. Elbows at ~45–75° from torso (not flared to 90°).
5. Touch chest lightly. Press bar in a slight arc back toward face.
6. Full lockout at top. Exhale on press.

**Common Errors:**
- ❌ Excessive elbow flare — shoulder landmark angle
- ❌ Bar bouncing off chest — velocity detection at bottom
- ❌ Incomplete range of motion — wrist to chest distance
- ❌ Butt rising off bench — hip landmark elevation change

**Breathing:** Inhale on descent → hold at chest → exhale on press up

**Modifications:**
- Easier: Push-up, floor press, resistance band press
- Harder: Close-grip bench, paused bench, incline bench

**Guidance Modes:** 📸 ✅ | 🎬 ✅ | 📷 ⚠️ Partial *(lying flat — overhead camera or side camera needed; standard front camera misses depth)*

**MediaPipe Verdict:** ⚠️ Partial — Requires overhead or side camera. Wrist path, elbow angle partially trackable.

---

### A4 — Pull-Up / Chin-Up

| Field | Detail |
|---|---|
| **Equipment** | Pull-up bar |
| **Primary Muscles** | Latissimus Dorsi, Biceps, Rear Deltoid |
| **Secondary** | Rhomboids, Teres Major, Core |
| **Difficulty** | Intermediate |
| **Track** | Sets, Reps, Grip type (overhand/underhand/neutral), Assist band used |

**Step-by-step Instructions:**
1. Hang from bar with full arm extension. Depress and retract scapulae before initiating.
2. Overhand (pull-up): hands just outside shoulder-width. Underhand (chin-up): shoulder-width, palms facing you.
3. Initiate by driving elbows toward floor — do not shrug shoulders.
4. Pull until chin clears bar (minimum) or chest touches bar (advanced).
5. Lower with control over 3 counts. Full dead hang at bottom.

**Common Errors:**
- ❌ Kipping / using momentum — hip landmark oscillation detection
- ❌ Incomplete ROM (not reaching dead hang) — elbow angle at bottom
- ❌ Chin not clearing bar — chin-to-bar height comparison
- ❌ Shrugging shoulders up — shoulder elevation detection

**Breathing:** Exhale on the pull up → inhale on the way down

**Modifications:**
- Easier: Band-assisted pull-up, TRX row, lat pulldown
- Harder: Weighted pull-up, L-sit pull-up, one-arm progression

**Guidance Modes:** 📸 ✅ | 🎬 ✅ | 📷 ✅ 100% *(full body visible from front or side; landmark tracking reliable on bar)*

**MediaPipe Verdict:** ✅ 100% — Elbow angle, chin-to-bar, ROM, rep count all trackable.

---

### A5 — Overhead Press (Barbell / Dumbbell)

| Field | Detail |
|---|---|
| **Equipment** | Barbell / Dumbbells / Resistance band |
| **Primary Muscles** | Anterior & Medial Deltoid, Triceps |
| **Secondary** | Upper Pec, Serratus, Core (stabiliser) |
| **Difficulty** | Intermediate |
| **Track** | Sets, Reps, Load (kg), Elbow position, Lockout |

**Step-by-step Instructions:**
1. Stand with feet shoulder-width. Bar at upper chest / front rack position.
2. Brace core and glutes. Neutral spine — avoid hyperextending lower back.
3. Press bar directly overhead in a straight vertical path. Chin slightly back as bar passes face.
4. At lockout: arms fully extended, bar over heels, head through ("through the window").
5. Lower under control to starting position.

**Common Errors:**
- ❌ Lower back hyperextension — hip-shoulder-ear angle
- ❌ Bar path drifting forward — wrist horizontal movement
- ❌ Incomplete lockout — elbow angle at top
- ❌ Elbow flare — shoulder-to-elbow angle

**Breathing:** Inhale and brace → exhale on press → inhale on return

**Modifications:**
- Easier: Seated dumbbell press, Arnold press, band press
- Harder: Push press, Z-press, behind-neck press

**Guidance Modes:** 📸 ✅ | 🎬 ✅ | 📷 ✅ 100% *(full body visible standing; elbow and shoulder angles fully trackable from front or side)*

**MediaPipe Verdict:** ✅ 100% — Elbow angle, lockout, torso lean, bar path all trackable.

---

### A6 — Romanian Deadlift (RDL)

| Field | Detail |
|---|---|
| **Equipment** | Barbell / Dumbbells / Resistance band |
| **Primary Muscles** | Hamstrings, Glutes |
| **Secondary** | Erector Spinae, Core |
| **Difficulty** | Beginner-Intermediate |
| **Track** | Sets, Reps, Load, Hip hinge angle, Hamstring stretch depth |

**Instructions:**
1. Stand with feet hip-width, barbell in front (or dumbbells at thighs).
2. Soft bend in knees — maintain throughout. This is NOT a squat.
3. Hinge at hips: push hips back, bar slides down legs, chest stays tall.
4. Lower until hamstring stretch is felt (usually shin level) — back stays neutral.
5. Drive hips forward to return. Squeeze glutes at top. Do not hyperextend.

**Common Errors:**
- ❌ Rounding lower back — torso angle detection
- ❌ Bending knees excessively (turning into squat) — knee angle change
- ❌ Not achieving full hamstring stretch — hip-to-ankle distance

**MediaPipe Verdict:** ✅ 100% — Side camera clearly tracks hip hinge angle, knee angle, back alignment.

---

### A7 — Barbell/Dumbbell Row

| Field | Detail |
|---|---|
| **Equipment** | Barbell / Dumbbells |
| **Primary Muscles** | Latissimus Dorsi, Rhomboids, Middle Trapezius |
| **Secondary** | Biceps, Rear Deltoid, Erector Spinae |
| **Difficulty** | Beginner-Intermediate |
| **Track** | Sets, Reps, Load, Elbow path, Hip hinge angle |

**Instructions:**
1. Hip hinge to ~45° (barbell row) or 90° (Pendlay row). Chest tall, neutral spine.
2. Grip shoulder-width or slightly wider. Arms hanging perpendicular to floor.
3. Row by driving elbows toward ceiling — do not shrug.
4. Touch bar to lower sternum / navel (not upper chest).
5. Lower with control. Full arm extension at bottom.

**Common Errors:**
- ❌ Using momentum / swinging — torso oscillation detection
- ❌ Pulling to wrong point — wrist-to-torso height at peak
- ❌ Rounded back — torso angle

**MediaPipe Verdict:** ⚠️ Partial — Torso angle, elbow drive trackable from side. Contact point inference limited.

---

### A8 — Hip Thrust / Glute Bridge

| Field | Detail |
|---|---|
| **Equipment** | Barbell + bench / Bodyweight |
| **Primary Muscles** | Gluteus Maximus |
| **Secondary** | Hamstrings, Core, Hip Flexors |
| **Difficulty** | Beginner |
| **Track** | Sets, Reps, Load, Hip extension height, Hold duration |

**Instructions:**
1. Upper back on bench edge. Bar across hips (padded). Feet flat, hip-width, knees bent 90°.
2. Drive hips toward ceiling — squeeze glutes hard at top.
3. Full hip extension: torso parallel to floor or higher. No hyperextension of lower back.
4. Lower until glutes barely touch floor. Immediately drive back up.

**Common Errors:**
- ❌ Lower back arching instead of hip extension — hip vs lumbar angle
- ❌ Incomplete hip extension — hip landmark height at peak
- ❌ Feet too far or close — knee-to-90° check

**MediaPipe Verdict:** ✅ 100% — Side camera: hip extension angle, height, rep count all trackable. Camera Vision excellent for this exercise.

---

## 💪 CATEGORY B — STRENGTH: ISOLATION MOVEMENTS

*Single-joint exercises targeting a specific muscle group.*

| # | Exercise | Primary Muscle | Equipment | Track | MediaPipe |
|---|---|---|---|---|---|
| B1 | Bicep Curl | Biceps | DB/BB/Band | Sets, Reps, Load, Elbow angle | ✅ 100% |
| B2 | Hammer Curl | Biceps (long head), Brachialis | Dumbbells | Sets, Reps, Load | ✅ 100% |
| B3 | Concentration Curl | Biceps | Dumbbell | Sets, Reps, Load | ✅ 100% |
| B4 | Tricep Pushdown | Triceps | Cable | Sets, Reps, Load | ⚠️ Partial |
| B5 | Skull Crusher | Triceps | EZ Bar / Dumbbells | Sets, Reps, Load | ⚠️ Partial (lying) |
| B6 | Overhead Tricep Extension | Triceps | Dumbbell / Band | Sets, Reps, Load | ✅ 100% |
| B7 | Lateral Raise | Medial Deltoid | Dumbbells / Band | Sets, Reps, Load, Arm angle | ✅ 100% |
| B8 | Front Raise | Anterior Deltoid | Dumbbells / Plate | Sets, Reps, Load | ✅ 100% |
| B9 | Reverse Fly | Rear Deltoid | Dumbbells / Band | Sets, Reps, Load | ✅ 100% |
| B10 | Face Pull | Rear Delt, Rotator Cuff | Cable / Band | Sets, Reps, Load | ⚠️ Partial |
| B11 | Shrug | Upper Trapezius | BB / DB | Sets, Reps, Load, Shoulder elevation | ✅ 100% |
| B12 | Calf Raise | Gastrocnemius, Soleus | BW / Machine | Sets, Reps, Load, ROM | ✅ 100% |
| B13 | Leg Curl | Hamstrings | Machine | Sets, Reps, Load | ❌ Machine |
| B14 | Leg Extension | Quadriceps | Machine | Sets, Reps, Load | ❌ Machine |
| B15 | Leg Press | Quads, Glutes | Machine | Sets, Reps, Load, Depth | ❌ Machine |
| B16 | Chest Fly (Dumbbell) | Pectorals | Dumbbells | Sets, Reps, Load, Arc width | ⚠️ Partial (lying) |
| B17 | Cable Crossover | Pectorals | Cable machine | Sets, Reps, Load | ❌ Machine setup |
| B18 | Lat Pulldown | Latissimus Dorsi | Cable machine | Sets, Reps, Load | ❌ Machine |
| B19 | Cable Row | Back | Cable machine | Sets, Reps, Load | ❌ Machine |
| B20 | Hip Abduction | Glute Medius | Band / Machine | Sets, Reps, Load | ✅ 100% (standing) |

**Full detail — B1 Bicep Curl:**

**Instructions:**
1. Stand with dumbbells at sides, palms forward.
2. Keep elbows pinned at ribs — they should not drift forward.
3. Curl weight toward shoulder. Squeeze bicep at top.
4. Lower under control over 3 counts. Full extension at bottom.

**Common Errors:**
- ❌ Swinging torso — hip and shoulder landmark oscillation
- ❌ Elbows drifting forward — elbow position relative to shoulder
- ❌ Incomplete extension — elbow angle at bottom (should reach ~170°+)
- ❌ Wrist curling — wrist-to-elbow angle (partially detectable with MediaPipe Hands)

**MediaPipe Tracking:** Elbow angle (full range 30°–170°+), torso stability, rep count via elbow angle cycle. Front camera ideal.

---

## 🏠 CATEGORY C — BODYWEIGHT & HOME TRAINING

*No-equipment or minimal-equipment movements. Perfect for home users, travellers, and beginners.*

---

### C1 — Push-Up (Standard)

| Field | Detail |
|---|---|
| **Equipment** | None (floor) |
| **Primary Muscles** | Pectoralis Major, Anterior Deltoid, Triceps |
| **Secondary** | Core, Serratus Anterior |
| **Difficulty** | Beginner |
| **Track** | Sets, Reps, Tempo, Variation |

**Instructions:**
1. Hands slightly wider than shoulders, fingers pointing forward. Body forms a straight line head to heels.
2. Brace core — no sagging hips or piking.
3. Lower chest to just above floor. Elbows at ~45° from body.
4. Press back to full arm extension. Squeeze chest at top.

**Push-Up Variations & Difficulty Ladder:**

| Variation | Angle | Primary Target | Difficulty |
|---|---|---|---|
| Wall push-up | Vertical | Chest | Very Easy |
| Incline push-up | 45° raised hands | Chest | Easy |
| Standard push-up | Horizontal | Chest / Triceps | Beginner |
| Decline push-up | Feet elevated | Upper Chest | Intermediate |
| Diamond push-up | Hands together | Triceps | Intermediate |
| Wide push-up | Hands wide | Chest (lateral) | Intermediate |
| Archer push-up | Asymmetric | Unilateral | Advanced |
| Pike push-up | Hips high | Shoulders | Intermediate |
| Pseudo planche | Hands by hips | Serratus, anterior delt | Advanced |
| One-arm push-up | Single hand | Full strength | Expert |

**Common Errors:**
- ❌ Hips sagging — hip landmark dropping below shoulder-ankle line
- ❌ Piking hips — hip landmark rising above straight line
- ❌ Incomplete depth — chest-to-floor distance (estimated via shoulder landmark drop)
- ❌ Elbow flare to 90° — elbow angle relative to torso

**MediaPipe Verdict:** ✅ 100% — Side camera: full body alignment, hip position, depth, elbow angle, rep count all trackable.

---

### C2 — Bodyweight Squat → Bulgarian Split Squat

**Instructions (Bodyweight Squat):**
1. Feet shoulder-width, toes 15–20° out. Arms forward for counterbalance.
2. Sit hips back and down simultaneously. Chest tall.
3. Reach parallel (or deeper). Knees track over toes throughout.
4. Drive through mid-foot to stand. Squeeze glutes at top.

**Bulgarian Split Squat Instructions:**
1. Rear foot elevated on bench or chair ~knee height. Front foot forward enough for 90° knee angle.
2. Lower rear knee toward floor. Front knee tracks over front foot.
3. Drive through front heel. Keep torso upright.

**Common Errors (BSS):**
- ❌ Front knee caving — knee vs toe landmark alignment
- ❌ Torso excessive lean — shoulder-to-hip angle
- ❌ Incomplete depth — rear knee to floor distance

**Home Exercise Library — Key Movements:**

| Exercise | Primary Muscle | Equipment | Track | MediaPipe |
|---|---|---|---|---|
| Bodyweight Squat | Quads, Glutes | None | Sets, Reps, Depth | ✅ 100% |
| Lunge (Forward) | Quads, Glutes | None | Sets, Reps (each leg) | ✅ 100% |
| Reverse Lunge | Glutes, Quads | None | Sets, Reps, Knee angle | ✅ 100% |
| Walking Lunge | Glutes, Quads | None | Sets, Steps | ✅ 100% |
| Lateral Lunge | Adductors, Glutes | None | Sets, Reps (each side) | ✅ 100% |
| Curtsy Lunge | Glutes (medius) | None | Sets, Reps | ✅ 100% |
| Glute Bridge | Glutes | None | Sets, Reps, Hold | ✅ 100% |
| Single-Leg Glute Bridge | Glutes | None | Sets, Reps | ✅ 100% |
| Donkey Kick | Glutes | None | Sets, Reps | ✅ 100% |
| Fire Hydrant | Glute Medius | None | Sets, Reps | ✅ 100% |
| Clamshell | Glute Medius | None / Band | Sets, Reps | ✅ 100% |
| Side-Lying Leg Raise | Hip Abductor | None | Sets, Reps, ROM | ⚠️ Partial |
| Bird-Dog | Core, Glutes | None | Sets, Reps | ✅ 100% |
| Superman | Erector Spinae | None | Sets, Reps, Hold | ✅ 100% |
| Plank | Core | None | Duration, Alignment | ✅ 100% |
| Side Plank | Obliques | None | Duration, Alignment | ✅ 100% |
| Mountain Climber | Core, Cardio | None | Sets, Reps, Pace | ✅ 100% |
| Burpee | Full Body | None | Sets, Reps, Time | ✅ 100% |
| Jump Squat | Quads, Calves | None | Sets, Reps, Jump height | ✅ 100% |
| Star Jump (Jumping Jack) | Full Body | None | Duration, Reps | ✅ 100% |
| High Knees | Hip Flexors, Cardio | None | Duration, Pace | ✅ 100% |
| Butt Kicks | Hamstrings, Cardio | None | Duration, Pace | ✅ 100% |
| Step-Up | Quads, Glutes | Chair/Step | Sets, Reps (each leg) | ✅ 100% |
| Chair Dip | Triceps | Chair | Sets, Reps, Elbow angle | ✅ 100% |
| Wall Sit | Quads | Wall | Duration, Knee angle | ✅ 100% |
| Inchworm | Hamstrings, Core | None | Sets, Reps | ✅ 100% |
| Bear Crawl | Full Body | None | Distance, Time | ⚠️ Partial |
| Crab Walk | Triceps, Glutes | None | Distance, Time | ⚠️ Partial |
| Dead Bug | Core | None | Sets, Reps | ✅ 100% |

**Full detail — Plank:**

**Instructions:**
1. Forearms on floor, elbows under shoulders. Body forms a straight line from head to heels.
2. Brace core: pull navel to spine. Squeeze glutes. Avoid holding breath.
3. Hold position. If hips sag or pike, reduce duration.
4. Gaze at floor 6 inches in front — neutral neck.

**What to Track:** Duration (seconds), alignment score (hip position), breathing consistency

**Common Errors:**
- ❌ Hip sag — hip landmark drops below shoulder-ankle midpoint (automated flag)
- ❌ Pike — hip landmark rises above line
- ❌ Shoulder rounding — scapulae position (partial inference)
- ❌ Neck hyperextension — nose-to-shoulder angle

**MediaPipe Verdict:** ✅ 100% — Side camera gives complete alignment score, real-time feedback.

---

## ⚙️ CATEGORY D — FUNCTIONAL TRAINING

*Compound movements that mimic real-life or sport-specific patterns: push, pull, hinge, squat, carry, rotate.*

| # | Exercise | Pattern | Equipment | Track | MediaPipe |
|---|---|---|---|---|---|
| D1 | Kettlebell Swing | Hip Hinge / Explosive | Kettlebell | Sets, Reps, Hip snap quality | ✅ 100% |
| D2 | Goblet Squat | Squat | KB / DB | Sets, Reps, Depth, Elbow angle | ✅ 100% |
| D3 | Turkish Get-Up | Multi-pattern | KB / DB | Sets, Reps (L/R), Phases | ⚠️ Partial |
| D4 | Pallof Press | Anti-rotation core | Band / Cable | Sets, Reps, Hold | ✅ 100% |
| D5 | Farmer's Carry | Loaded Carry | DBs / Bags | Distance, Time, Posture | ✅ 100% |
| D6 | Suitcase Carry | Lateral carry | One DB | Distance, Time, Lateral lean | ✅ 100% |
| D7 | Single-Leg Deadlift | Hinge + Balance | DB / BW | Sets, Reps, Balance quality | ✅ 100% |
| D8 | Lateral Band Walk | Hip Abduction | Resistance band | Distance, Steps | ✅ 100% |
| D9 | Monster Walk | Multi-plane hip | Resistance band | Distance, Steps | ✅ 100% |
| D10 | Rotational Squat to Press | Multi-plane | Band / DB | Sets, Reps | ✅ 100% |
| D11 | Chop and Lift | Core rotation | Band / Cable | Sets, Reps | ⚠️ Partial |
| D12 | Box Jump | Explosive lower body | Box / Step | Sets, Reps, Height, Landing | ✅ 100% |
| D13 | Broad Jump | Explosive / Power | None | Sets, Reps, Distance | ✅ 100% |
| D14 | Lateral Bound | Lateral power | None | Sets, Reps | ✅ 100% |

**Full detail — Kettlebell Swing:**

**Instructions:**
1. Feet slightly wider than hip-width. KB on floor between feet.
2. Hip hinge to grip KB. Neutral spine, lats engaged.
3. Hike KB back between legs (like hiking a football). Keep it high.
4. Explosive hip snap forward — power comes from glutes, not arms. Arms swing to shoulder height passively.
5. At top: standing tall, glutes squeezed, quads tight. NOT a squat.
6. Let KB fall back between legs. Re-hinge immediately. Rhythm: hinge-snap-swing.

**Common Errors:**
- ❌ Squatting instead of hinging — knee vs hip angle comparison
- ❌ Using arms to lift — elbow vs shoulder height
- ❌ Not achieving full hip extension at top — hip angle at peak
- ❌ Rounding back at bottom — torso angle during hike

**MediaPipe Verdict:** ✅ 100% — Side camera: hip snap, extension, back angle, rhythm. Excellent exercise for Camera Vision.

---

## 🏃 CATEGORY E — CARDIO & CONDITIONING

*Duration and intensity-based activities. Logged with cardio-mode fields (not sets/reps).*

| Exercise | Format | Track (Primary) | Track (Optional) | MediaPipe |
|---|---|---|---|---|
| Easy Run / Zone 2 | Steady state | Duration (min), Distance (km), HR Zone | Pace (min/km) | ⚠️ Partial (if on treadmill visible) |
| Tempo Run | Sustained effort | Duration, Distance, Pace | Perceived effort | ⚠️ Partial |
| Interval Run | Work/rest cycles | Intervals completed, Work pace, Rest HR | Distance per interval | ⚠️ Partial |
| Sprint (max effort) | Short explosive | Sets, Distance (m), Time per sprint | Recovery time | ✅ 100% (if in frame) |
| Hill Run | Sustained incline | Duration, Elevation (m), Pace | HR | ❌ Location-based |
| Fartlek | Unstructured intervals | Duration, Effort description | — | ❌ Unstructured |
| Cycling (outdoor) | Steady / intervals | Duration, Distance, Pace | Calories, HR | ❌ Body static on bike |
| Cycling (stationary) | Steady / intervals | Duration, Resistance, Cadence | Calories, Watts | ❌ Body minimal movement |
| Rowing Machine | Full body cardio | Duration, Distance (m), Pace (/500m) | Stroke rate | ⚠️ Partial (drive phase trackable) |
| Jump Rope (basic) | Cardio | Duration, Reps, Missed jumps | — | ✅ 100% |
| Jump Rope (double under) | Advanced cardio | Duration, Doubles completed | Errors | ✅ 100% |
| Box Step (low) | Low-impact cardio | Duration, Steps/min | — | ✅ 100% |
| High Knees (drill) | Cardio/mobility | Duration, Pace | Knee height score | ✅ 100% |
| Butt Kicks (drill) | Cardio/mobility | Duration, Pace | Heel-to-glute score | ✅ 100% |
| Agility Ladder | Speed & coordination | Time, Errors | Pattern type | ✅ 100% |
| Shuttle Run | Anaerobic cardio | Sets, Distance, Time | — | ✅ 100% |
| Swimming | Full body cardio | Duration, Laps, Stroke type | — | ❌ Underwater |
| Elliptical | Low-impact cardio | Duration, Distance, Resistance | Calories | ❌ Machine |

---

## ⚡ CATEGORY F — HIIT PROTOCOLS

*High-intensity protocols combining multiple exercise categories.*

| Protocol | Structure | Track | Exercises Included | MediaPipe |
|---|---|---|---|---|
| Tabata | 20s work / 10s rest × 8 = 4 min | Reps per interval, Effort level | Burpees, Squats, Push-ups | ✅ 100% per exercise |
| EMOM (Every Minute on the Minute) | X reps at top of each minute | Reps completed, Remaining rest | Any compound movement | ✅ 100% per exercise |
| AMRAP (As Many Rounds As Possible) | Fixed time, max rounds | Rounds completed, Total reps | Mixed circuit | ✅ 100% per exercise |
| 30-20-10 Interval | 30s easy / 20s moderate / 10s hard | Effort levels maintained | Running or cardio | ⚠️ Partial |
| Pyramid Sets | Increasing then decreasing reps | Sets completed, Load used | Strength movements | ✅ 100% per exercise |
| Density Block | Max reps in fixed time | Total reps, Rest taken | Any | ✅ 100% per exercise |

**Home HIIT Circuit Example (no equipment):**
- Jump Squat × 10
- Push-up × 10
- Mountain Climber × 20
- Reverse Lunge × 10 each
- Plank × 30 sec
→ Rest 90 sec. Repeat 4 rounds.

**MediaPipe full circuit tracking:** ✅ 100% — All components above fully trackable.

---

# 🧘 CATEGORY G — YOGA: STANDING POSES

*Organised by yoga pose family. Each pose includes Sanskrit name, alignment cues, what Camera Vision tracks.*

---

### Sun Salutation Sequences

**G1 — Surya Namaskar A (Sun Salutation A)**

*12-pose vinyasa linking breath to movement. The foundational flow.*

| Pose | Sanskrit | Key Alignment | Breath | MediaPipe |
|---|---|---|---|---|
| Mountain Pose | Tadasana | Feet together, arms at sides, crown tall | Natural | ✅ 100% |
| Upward Salute | Urdhva Hastasana | Arms overhead, slight backbend | Inhale | ✅ 100% |
| Standing Forward Fold | Uttanasana | Hinge at hips, spine long | Exhale | ✅ 100% |
| Halfway Lift | Ardha Uttanasana | Flat back, hands on shins | Inhale | ✅ 100% |
| Plank Pose | Phalakasana | Push-up top position | Hold | ✅ 100% |
| Four-Limbed Staff | Chaturanga Dandasana | Lower halfway, elbows 90° | Exhale | ✅ 100% |
| Upward Dog | Urdhva Mukha Svanasana | Chest open, thighs off floor | Inhale | ✅ 100% |
| Downward Dog | Adho Mukha Svanasana | Hips high, heels toward floor | Exhale | ✅ 100% |
| Halfway Lift | Ardha Uttanasana | Step forward, flat back | Inhale | ✅ 100% |
| Standing Forward Fold | Uttanasana | Full fold | Exhale | ✅ 100% |
| Upward Salute | Urdhva Hastasana | Rise to arms overhead | Inhale | ✅ 100% |
| Mountain Pose | Tadasana | Return to standing | Exhale | ✅ 100% |

**Track:** Rounds completed, Hold time per pose, Breath synchronisation, Alignment score per pose

---

### Standing Balance & Strength Poses

| # | Pose | Sanskrit | Hold | Key Alignment | Track | MediaPipe |
|---|---|---|---|---|---|---|
| G2 | Warrior I | Virabhadrasana I | 5–10 breaths each side | Front knee over ankle, hips squared, arms overhead | Hold (sec), Knee angle, Hip angle | ✅ 100% |
| G3 | Warrior II | Virabhadrasana II | 5–10 breaths each side | Front knee 90°, arms parallel, gaze over front hand | Hold, Knee angle, Arm alignment | ✅ 100% |
| G4 | Warrior III | Virabhadrasana III | 5–10 breaths each side | Standing leg straight, back leg + torso parallel to floor | Hold, Hip alignment, Balance sway | ✅ 100% |
| G5 | Reverse Warrior | Viparita Virabhadrasana | 5 breaths each side | Back hand on back leg, front arm arcs overhead | Hold, Lateral bend angle | ✅ 100% |
| G6 | Triangle Pose | Trikonasana | 5–10 breaths each side | Legs straight, front hand to shin/block, top arm to sky | Hold, Hip alignment, Arm angle | ✅ 100% |
| G7 | Extended Side Angle | Utthita Parsvakonasana | 5 breaths each side | Front knee 90°, forearm on thigh, top arm extended | Hold, Body line | ✅ 100% |
| G8 | Chair Pose | Utkatasana | 5–10 breaths | Knees bend, arms overhead, weight in heels | Hold (sec), Knee angle, Torso angle | ✅ 100% |
| G9 | Tree Pose | Vrikshasana | 30–60 sec each side | One foot on inner calf/thigh (not knee), hips level | Hold, Balance sway (hip landmark drift) | ✅ 100% |
| G10 | Eagle Pose | Garudasana | 5 breaths each side | Arms crossed at elbows, legs wrapped, one foot hooked | Hold, Balance quality | ✅ 100% |
| G11 | Half Moon | Ardha Chandrasana | 5 breaths each side | One hand on floor, body parallel to floor, top arm up | Hold, Hip level | ✅ 100% |
| G12 | Standing Split | Urdhva Prasarita Eka Padasana | 5–10 breaths | One leg raised, hips squared, hands to floor | Hold, Leg height | ✅ 100% |
| G13 | Crescent Lunge | Anjaneyasana | 5–10 breaths each side | Back knee low or lifted, hips squared, arms overhead | Hold, Knee angle | ✅ 100% |
| G14 | Goddess Pose | Utkata Konasana | 10 breaths | Wide stance, deep knee bend, arms cactus | Hold, Knee angle, Depth | ✅ 100% |

---

### Forward Folds

| # | Pose | Sanskrit | Hold | Key Alignment | MediaPipe |
|---|---|---|---|---|---|
| G15 | Standing Forward Fold | Uttanasana | 10–20 breaths | Hinge at hips, spine long before rounding | ✅ 100% |
| G16 | Seated Forward Fold | Paschimottanasana | 10–20 breaths | Hinge at hips, back straight then fold | ✅ 100% |
| G17 | Wide-Legged Forward Fold | Prasarita Padottanasana | 10–20 breaths | Crown of head toward floor | ✅ 100% |
| G18 | Pyramid Pose | Parsvottanasana | 5–10 breaths each side | Squared hips, forward fold over front leg | ✅ 100% |

---

### Backbends

| # | Pose | Sanskrit | Hold | Key Alignment | Track | MediaPipe |
|---|---|---|---|---|---|---|
| G19 | Cobra | Bhujangasana | 5–10 breaths | Elbows soft, chest leads, hips on floor | Hold (sec), Back extension angle | ✅ 100% |
| G20 | Upward Dog | Urdhva Mukha Svanasana | 3–5 breaths | Arms straight, thighs off floor | Hold, Arm angle | ✅ 100% |
| G21 | Camel | Ustrasana | 5 breaths | Hips forward, hands to heels, chin neutral | Hold, Back extension depth | ✅ 100% |
| G22 | Bridge Pose | Setu Bandha | 10–20 breaths | Feet hip-width, hips lift, chin away from chest | Hold (sec), Hip height | ✅ 100% |
| G23 | Wheel / Full Backbend | Urdhva Dhanurasana | 5–10 breaths | Arms and legs extended, full spinal arch | Hold, Arc depth | ⚠️ Partial |
| G24 | Fish Pose | Matsyasana | 10 breaths | Supported on elbows/hands, chest opens | Hold | ⚠️ Partial (lying) |

---

### Hip Openers

| # | Pose | Sanskrit | Hold | Key Alignment | Track | MediaPipe |
|---|---|---|---|---|---|---|
| G25 | Pigeon Pose | Kapotasana | 2–5 min each side | Front shin horizontal, fold forward | Hold duration, Hip alignment | ✅ 100% |
| G26 | Low Lunge | Anjaneyasana | 10–20 breaths | Back knee on floor, hips square | Hold, Knee angle | ✅ 100% |
| G27 | Butterfly | Baddha Konasana | 10–20 breaths | Soles of feet together, fold forward | Hold, Knee height | ✅ 100% |
| G28 | Lizard Pose | Utthan Pristhasana | 10 breaths | Front foot outside front hand | Hold, Hip depth | ✅ 100% |
| G29 | Happy Baby | Ananda Balasana | 10–20 breaths | Lying, knees to armpits, feet flexed | Hold | ⚠️ Partial (lying) |
| G30 | Reclined Figure-4 | Supta Kapotasana | 20–30 breaths | Lying, ankle on opposite knee | Hold duration | ⚠️ Partial (lying) |
| G31 | Frog Pose | Mandukasana | 2–5 min | On all fours, knees wide, toes touching | Hold | ✅ 100% |
| G32 | Half Splits | Ardha Hanumanasana | 10–20 breaths | Front leg extended, hinge at hip | Hold, Hip-to-heel distance | ✅ 100% |
| G33 | Full Splits | Hanumanasana | 30–60 sec | Full anterior-posterior split | Hold, Pelvis-floor distance | ✅ 100% |

---

### Twists

| # | Pose | Sanskrit | Hold | MediaPipe |
|---|---|---|---|---|
| G34 | Seated Spinal Twist | Ardha Matsyendrasana | 10 breaths each side | ✅ 100% |
| G35 | Supine Twist | Supta Matsyendrasana | 20–30 breaths each side | ⚠️ Partial (lying) |
| G36 | Revolved Chair | Parivrtta Utkatasana | 5–10 breaths each side | ✅ 100% |
| G37 | Revolved Triangle | Parivrtta Trikonasana | 5–10 breaths each side | ✅ 100% |

---

### Inversions & Advanced

| # | Pose | Sanskrit | Hold | Difficulty | MediaPipe |
|---|---|---|---|---|---|
| G38 | Downward Dog | Adho Mukha Svanasana | 5–20 breaths | Beginner | ✅ 100% |
| G39 | Dolphin Pose | Makarasana | 5–10 breaths | Intermediate | ✅ 100% |
| G40 | Headstand | Sirsasana | 5–10 breaths | Advanced | ⚠️ Partial |
| G41 | Shoulder Stand | Sarvangasana | 10–20 breaths | Intermediate | ⚠️ Partial |
| G42 | Crow Pose | Bakasana | 5–10 breaths | Advanced | ⚠️ Partial |
| G43 | Side Crow | Parsva Bakasana | 5 breaths | Advanced | ⚠️ Partial |

---

## 🌙 CATEGORY H — YIN YOGA (Long-hold passive poses)

*Targets connective tissue (fascia, ligaments, joint capsules). Each pose held 2–5+ minutes.*

| # | Pose | Area Targeted | Hold | Key Cue | MediaPipe |
|---|---|---|---|---|---|
| H1 | Dragon Pose | Hip flexors, Quads | 3–5 min each | Low lunge, back knee down, sink into hips | ✅ 100% |
| H2 | Sleeping Swan | Piriformis, Outer hip | 3–5 min each | Pigeon-like, fold completely forward | ✅ 100% |
| H3 | Butterfly (Yin) | Inner thighs, Lower back | 5–10 min | Soles together, round forward | ✅ 100% |
| H4 | Saddle | Quads, Psoas, Sacrum | 3–10 min | Reclined hero's pose | ⚠️ Partial |
| H5 | Sphinx Pose | Lumbar spine (gentle) | 5–10 min | On elbows, chest lifted, hips on floor | ⚠️ Partial |
| H6 | Seal Pose | Lumbar, Chest | 3–5 min | Arms extended, deep backbend | ⚠️ Partial |
| H7 | Child's Pose | Lower back, Hips | 5–10 min | Knees wide or together, arms forward | ✅ 100% |
| H8 | Shoelace Pose | IT Band, Outer hip | 3–5 min each | Knees stacked, sit tall | ✅ 100% |
| H9 | Deer Pose | Hip rotators, Psoas | 3–5 min each | Figure-4 position | ✅ 100% |
| H10 | Dragonfly | Hamstrings, Adductors | 5–10 min | Straddle forward fold | ✅ 100% |
| H11 | Supported Fish | Thoracic spine, Chest | 10 min | Blanket/block under shoulder blades | ⚠️ Partial |
| H12 | Legs Up the Wall | Lower back, Nervous system | 10–20 min | Hips at wall, legs vertical | ⚠️ Partial (lying) |
| H13 | Savasana | Full system reset | 5–10 min | Complete stillness | ❌ (no movement) |

**Track for Yin:** Hold duration per pose (timer), Comfort scale (1–5), Session quality

---

## 🎯 CATEGORY I — PILATES

*Core-centric controlled movements with strong emphasis on breath and spine alignment.*

| # | Exercise | Primary Focus | Level | Track | MediaPipe |
|---|---|---|---|---|---|
| I1 | The Hundred | Core, Breath | Beginner | Sets, Reps (10 breaths = 1 round), Leg height | ✅ 100% |
| I2 | Roll-Up | Spinal flexion | Beginner | Sets, Reps, Spinal segmentation | ✅ 100% |
| I3 | Single Leg Circle | Hip mobility, Core stability | Beginner | Sets, Reps each direction/side | ✅ 100% |
| I4 | Rolling Like a Ball | Spinal massage | Beginner | Sets, Reps | ✅ 100% |
| I5 | Single Leg Stretch | Core, Hip flexor | Beginner | Sets, Reps | ✅ 100% |
| I6 | Double Leg Stretch | Core | Intermediate | Sets, Reps | ✅ 100% |
| I7 | Criss-Cross | Obliques | Intermediate | Sets, Reps | ✅ 100% |
| I8 | Scissors | Hamstrings, Core | Intermediate | Sets, Reps | ✅ 100% |
| I9 | Plank (Pilates) | Core, Full body | Beginner | Duration, Alignment | ✅ 100% |
| I10 | Swan Dive | Back extension | Intermediate | Sets, Reps | ⚠️ Partial (lying) |
| I11 | Swimming | Back extension, Alternating | Intermediate | Sets, Duration | ⚠️ Partial (lying) |
| I12 | Side Kick Series | Hip abduction, Core | Intermediate | Sets, Reps each direction | ⚠️ Partial (side lying) |
| I13 | Teaser | Core, Hip flexors | Advanced | Sets, Reps, Hold | ✅ 100% |
| I14 | Spine Stretch Forward | Spinal flexion, Hamstrings | Beginner | Sets, Reps | ✅ 100% |
| I15 | Saw | Spinal rotation, Hamstrings | Beginner | Sets, Reps each side | ✅ 100% |
| I16 | Mermaid | Lateral flexion | Beginner | Sets, Reps each side | ✅ 100% |
| I17 | Leg Pull (prone) | Core, Glutes | Intermediate | Sets, Reps | ✅ 100% |
| I18 | Push-Up (Pilates) | Chest, Triceps, Core | Intermediate | Sets, Reps | ✅ 100% |

**Track for Pilates:** Reps, Alignment quality, Breath timing (if audio guided), Range of motion notes

---

## 🔄 CATEGORY J — MOBILITY & FLEXIBILITY

*Daily movement maintenance. Organised by body region.*

### Upper Body Mobility

| # | Exercise | Area | Hold / Reps | Key Cue | MediaPipe |
|---|---|---|---|---|---|
| J1 | Cervical Spine Circles | Neck | 5 each direction | Slow, pain-free range | ✅ 100% |
| J2 | Lateral Neck Stretch | Neck | 30–45 sec each side | Ear to shoulder | ✅ 100% |
| J3 | Shoulder Dislocates (band) | Shoulder | 10–15 reps | Wide grip, full arc over head | ✅ 100% |
| J4 | Shoulder Circles | Shoulder | 10 each direction | Full ROM, slow | ✅ 100% |
| J5 | Cross-Body Arm Stretch | Posterior deltoid | 30 sec each side | Pull arm across chest | ✅ 100% |
| J6 | Doorway Chest Stretch | Pectorals | 30–45 sec | Forearms on doorframe | ✅ 100% |
| J7 | Thread the Needle | Thoracic rotation | 30 sec each side | From table top, arm under body | ✅ 100% |
| J8 | Thoracic Spine Rotation | T-spine | 10 each side | Side-lying, arm sweeps to sky | ⚠️ Partial (lying) |
| J9 | Thoracic Extension (roller) | T-spine | 60 sec | Upper back over foam roller | ⚠️ Partial |
| J10 | Wrist Circles | Wrist | 10 each direction | Full ROM | ✅ 100% |
| J11 | Wrist Extension Stretch | Wrist flexors | 30 sec | Arm extended, fingers down | ✅ 100% |
| J12 | Prayer Stretch | Wrist flexors | 30 sec | Palms together, lower hands | ✅ 100% |
| J13 | Forearm Stretch | Forearm extensors | 30 sec each | Arm out, pull fingers down | ✅ 100% |

### Spinal Mobility

| # | Exercise | Area | Reps / Hold | Key Cue | MediaPipe |
|---|---|---|---|---|---|
| J14 | Cat-Cow | Full spine | 10–15 cycles | Breath leads movement | ✅ 100% |
| J15 | Child's Pose | Lumbar, Thoracic, Shoulders | 1–3 min | Hips to heels | ✅ 100% |
| J16 | Sphinx to Cobra | Lumbar extension | 5–10 holds | Elbows to hands, controlled | ✅ 100% |
| J17 | Spinal Flexion Roll | Full spine | 10 slow reps | Chin to chest, roll down vertebra by vertebra | ✅ 100% |
| J18 | Seated Spinal Twist | T-spine rotation | 30 sec each | Use chair for leverage | ✅ 100% |
| J19 | World's Greatest Stretch | Full body (multi) | 5 reps each side | Lunge + rotation + reach | ✅ 100% |

### Hip Mobility

| # | Exercise | Area | Reps / Hold | Key Cue | MediaPipe |
|---|---|---|---|---|---|
| J20 | Hip 90/90 | Hip rotators | 2 min each side | Both hips at 90°, tall spine | ✅ 100% |
| J21 | Hip Circles (standing) | Hip joint | 10 each direction | Wide, controlled ROM | ✅ 100% |
| J22 | Couch Stretch | Quad, Hip Flexor | 2–3 min each | Rear foot on wall | ✅ 100% |
| J23 | Hip Flexor Stretch (kneeling) | Psoas, Rectus Femoris | 30–60 sec each | Drive hip forward | ✅ 100% |
| J24 | Pigeon Stretch | Piriformis, Glutes | 2–5 min each | Forward fold optional | ✅ 100% |
| J25 | Lateral Squat / Cossack | Adductors, Hip | 10 each side | Shift weight side to side | ✅ 100% |
| J26 | Deep Squat Hold | Hips, Ankles, Thoracic | 1–3 min | Feet flat, elbows push knees | ✅ 100% |

### Hamstrings & Posterior Chain

| # | Exercise | Area | Reps / Hold | MediaPipe |
|---|---|---|---|---|
| J27 | Standing Hamstring Stretch | Hamstrings | 30–60 sec each | ✅ 100% |
| J28 | Lying Hamstring Stretch | Hamstrings | 60 sec each | ⚠️ Partial |
| J29 | Seated Forward Fold | Hamstrings, Back | 60–120 sec | ✅ 100% |
| J30 | Half Splits | Hamstrings | 60 sec each | ✅ 100% |
| J31 | Straddle Forward Fold | Adductors, Hamstrings | 60–120 sec | ✅ 100% |

### Lower Leg & Ankle

| # | Exercise | Area | Reps / Hold | MediaPipe |
|---|---|---|---|---|
| J32 | Ankle Circles | Ankle joint | 10 each direction | ✅ 100% |
| J33 | Ankle Dorsiflexion (knee to wall) | Ankle mobility | 10 each side | ✅ 100% |
| J34 | Calf Stretch (straight knee) | Gastrocnemius | 30–60 sec | ✅ 100% |
| J35 | Calf Stretch (bent knee) | Soleus | 30–60 sec | ✅ 100% |
| J36 | Foot Circles | Foot/ankle | 10 each | ⚠️ Partial |

---

## ⚖️ CATEGORY K — BALANCE & PROPRIOCEPTION

*Single-leg stability, vestibular training, coordination. Tracks balance sway via hip-landmark drift.*

| # | Exercise | Primary Challenge | Duration / Reps | Track | MediaPipe |
|---|---|---|---|---|---|
| K1 | Single Leg Stand | Ankle & Hip stability | 30–60 sec each | Time, Sway score (hip drift) | ✅ 100% |
| K2 | Single Leg Stand (eyes closed) | Vestibular challenge | 15–30 sec each | Time, Sway score | ✅ 100% |
| K3 | Single Leg Deadlift | Hinge + balance | 10–12 reps each | Sets, Reps, Balance quality | ✅ 100% |
| K4 | Tree Pose (progressive) | Hip + ankle stability | 30–60 sec each | Time, Hip level deviation | ✅ 100% |
| K5 | Warrior III | Full body balance | 5–10 breaths each | Hold time, Hip alignment | ✅ 100% |
| K6 | Tandem Stand | Narrow base | 30–60 sec | Time | ✅ 100% |
| K7 | Tandem Walk | Dynamic balance | Distance | Steps, Deviations | ✅ 100% |
| K8 | Lateral Step-Overs | Dynamic lateral balance | 10 each direction | Steps, Speed | ✅ 100% |
| K9 | Star Excursion Balance Test | Multi-directional reach | 3 attempts each | Reach distance (estimated) | ⚠️ Partial |
| K10 | Bosu Ball Squat | Unstable surface | 10–15 reps | Reps, Depth, Balance | ⚠️ Partial |
| K11 | Single Leg Squat (Pistol progression) | Strength + balance | 5–10 each | Reps, Depth | ✅ 100% |
| K12 | Heel-Toe Walking | Vestibular / Proprioceptive | Distance | Steps, Deviations | ✅ 100% |

**Balance Sway Score — MediaPipe method:**
Hip landmark (average of L + R) X/Y coordinates are logged frame by frame. Standard deviation of position = sway score. Lower = better balance. This is one of the most powerful Camera Vision metrics unique to Kriya Mirror.

---

## 🌬️ CATEGORY L — BREATHWORK & RECOVERY

*Duration-based practices. No sets/reps — logged with session quality and duration.*

| # | Practice | Description | Duration | Track | MediaPipe |
|---|---|---|---|---|---|
| L1 | Diaphragmatic Breathing | Belly breathing, parasympathetic activation | 5–20 min | Duration, Belly vs chest expansion | ⚠️ Partial (chest rise) |
| L2 | 4-7-8 Breathing | Inhale 4, Hold 7, Exhale 8. Sleep / anxiety | 5–10 min | Cycles completed, Session quality | ❌ Timing only |
| L3 | Box Breathing | 4-4-4-4 rhythm. Navy SEAL focus protocol | 5–20 min | Cycles completed | ❌ Timing only |
| L4 | Alternate Nostril (Nadi Shodhana) | Balances hemispheres, reduces anxiety | 10 min | Rounds completed | ❌ Internal |
| L5 | Kapalabhati | Rapid exhales, passive inhale. Energising | 5 min | Rounds/min, Cycles | ❌ Too subtle |
| L6 | Bhramari (Humming Bee) | Vibration, vagal tone | 5–10 min | Rounds, Calm score | ❌ Sound-based |
| L7 | Wim Hof Breathing | 30–40 deep breaths + retention. Energising | 20 min | Rounds, Retention time | ❌ Internal |
| L8 | Ujjayi Pranayama | Ocean breath for yoga | During yoga | Breath quality | ❌ Sound-based |
| L9 | 360° Diaphragmatic Breathing | Breathing into back, sides, belly | 5–10 min | Duration | ❌ Too subtle |
| L10 | Yoga Nidra | Guided deep relaxation (body scan) | 20–45 min | Duration, Sleep readiness | ❌ Stillness |

---

## 🏸 CATEGORY M — SPORT-SPECIFIC TRAINING

### Badminton

| # | Exercise | Purpose | Track | MediaPipe |
|---|---|---|---|---|
| M1 | 6-Corner Footwork Drill | Speed, agility, court coverage | Time per circuit, Accuracy | ✅ 100% |
| M2 | Split Step Practice | Court response | Reaction time, Reps | ✅ 100% |
| M3 | Lunge Recovery | Lunges to net and back | Reps, Time | ✅ 100% |
| M4 | Shadow Smash | Shoulder, wrist power | Reps, ROM | ✅ 100% |
| M5 | Side Shuffle Drill | Lateral movement | Distance, Time | ✅ 100% |
| M6 | Jump Smash | Explosive power | Reps, Jump height | ✅ 100% |

### Running Drills

| # | Drill | Purpose | Track | MediaPipe |
|---|---|---|---|---|
| M7 | A-Skip | Coordination, hip drive | Reps, Distance | ✅ 100% |
| M8 | B-Skip | Hamstring activation | Reps, Distance | ✅ 100% |
| M9 | High Knees | Hip flexor strength, turnover | Duration, Knee height | ✅ 100% |
| M10 | Butt Kicks | Hamstring activation, cadence | Duration, Heel-to-glute | ✅ 100% |
| M11 | Carioca / Grapevine | Lateral coordination | Distance, Time | ✅ 100% |
| M12 | Straight-Leg Bounds | Stiffness, power | Reps, Distance | ✅ 100% |
| M13 | Strides | Speed development | Reps (80m strides) | ✅ 100% |

---

## 🤸 CATEGORY N — CALISTHENICS (Advanced Bodyweight)

| # | Exercise | Skill Required | Track | MediaPipe |
|---|---|---|---|---|
| N1 | L-Sit | Core compression | Hold duration | ✅ 100% |
| N2 | Skin the Cat | Shoulder circumduction | Reps | ✅ 100% |
| N3 | Muscle-Up | Pull + transition + dip | Reps | ✅ 100% |
| N4 | Handstand (wall) | Balance, shoulder stability | Hold duration | ✅ 100% |
| N5 | Handstand Push-Up | Shoulder strength | Sets, Reps | ✅ 100% |
| N6 | Front Lever | Core tension | Hold duration | ✅ 100% |
| N7 | Back Lever | Shoulder extension | Hold duration | ✅ 100% |
| N8 | Pistol Squat | Single-leg strength | Sets, Reps | ✅ 100% |
| N9 | Nordic Curl | Hamstring eccentric | Sets, Reps | ✅ 100% |
| N10 | Planche Lean | Planche progression | Hold duration | ✅ 100% |
| N11 | Dragon Flag | Core compression | Reps | ✅ 100% |
| N12 | Human Flag | Lateral core | Hold duration | ⚠️ Partial |

---

## Part 4 — MediaPipe Master Verdict Summary

### ✅ 100% Camera Vision Trackable (High Confidence)

| Exercise Group | Count | Key Metrics Tracked |
|---|---|---|
| All bodyweight exercises (plank, push-up, squat, lunge, glute bridge, etc.) | 25+ | Alignment, angle, depth, rep count |
| Pull-up / Chin-up | 1 | Elbow angle, chin-bar, ROM |
| Standing yoga poses (all Warriors, Chair, Triangle, etc.) | 18+ | Joint angles, balance, hold timer |
| All balance exercises (Tree, Single-leg stand, Warrior III) | 12+ | Sway score, hold duration |
| Overhead Press (standing) | 1 | Elbow angle, bar path, torso lean |
| Hip Thrust (glute bridge variation) | 1 | Hip extension angle, height |
| Kettlebell Swing | 1 | Hip snap, extension, back angle |
| All running drills (high knees, A-skip, carioca, etc.) | 7+ | Knee height, cadence, form |
| Bicep Curl (standing) | 1 | Elbow angle, ROM, torso stability |
| All standing mobility (cat-cow, hip circles, etc.) | 15+ | Joint ROM, alignment |
| Pilates (mat, visible positions) | 12+ | Body alignment, leg angles |
| Calisthenics (L-sit, handstand, pistol squat) | 8+ | Position quality, hold |

### ⚠️ Partial Tracking (Camera Angle Dependent)

| Exercise | Limitation | Recommendation |
|---|---|---|
| Back Squat | Barbell not tracked; side camera needed for depth | Side camera mode |
| Bench Press | Lying flat — standard front camera misses depth | Overhead or side camera |
| Deadlift | Back angle best from side; bar tracking impossible | Side camera mode |
| Floor-lying exercises (skull crusher, lying fly) | Overhead camera needed | Overhead camera |
| Machine exercises (leg curl, lat pulldown) | Body occluded by machine | Not recommended |
| Bear Crawl / Crab Walk | Partial body occlusion | Simplified tracking |
| Advanced inversions (headstand, handstand) | Inverted — landmark confidence drops | Front camera close |
| Thoracic rotation lying | Side-lying occludes joints | Limited use |
| Yin yoga supine poses | Similar to lying exercises | Overhead camera |

### ❌ Not Suitable for Camera Vision Tracking

| Exercise | Reason |
|---|---|
| Swimming | Underwater — camera cannot track |
| Stationary cycling | Body barely moves — no meaningful landmarks |
| Machine-based exercises (leg press, cable rows) | Body obscured / no movement pattern |
| Breathwork (4-7-8, box breathing) | Internal — no visible body movement |
| Rowing machine | Repetitive small movement; machine obscures |
| Yoga Nidra / Savasana | Complete stillness — nothing to track |
| Grip exercises | Requires MediaPipe Hands, not Pose |

---

## Part 5 — Deep Review: Missing Exercises & Final Additions

*After comprehensive review, the following categories were identified as missing and added:*

### ✅ Added — Senior & Rehabilitation Exercises

| # | Exercise | Purpose | Track | MediaPipe |
|---|---|---|---|---|
| SR1 | Seated March | Gait, Hip Flexor | Duration, Reps | ✅ 100% |
| SR2 | Sit-to-Stand | Functional mobility | Reps, Time | ✅ 100% |
| SR3 | Heel Raises (seated) | Calf pump, circulation | Reps | ✅ 100% |
| SR4 | Wall Push-Up | Chest strength (modified) | Sets, Reps | ✅ 100% |
| SR5 | Seated Hamstring Stretch | Posterior chain | Hold duration | ✅ 100% |
| SR6 | Seated Spinal Rotation | Thoracic flexibility | Reps, ROM | ✅ 100% |
| SR7 | Tandem Stand | Balance (accessible) | Hold duration | ✅ 100% |
| SR8 | Standing Hip Abduction (band) | Hip stability | Sets, Reps | ✅ 100% |

### ✅ Added — Pregnancy-Safe / Postnatal

| # | Exercise | Purpose | Track | Notes |
|---|---|---|---|---|
| P1 | Side-Lying Clamshell | Glute Medius | Sets, Reps | Trimester-safe |
| P2 | Seated Pelvic Tilts | Core activation | Sets, Reps | All trimesters |
| P3 | Cat-Cow (modified) | Spinal decompression | Reps | All trimesters |
| P4 | Supported Squat | Hip opening | Hold duration | 3rd trimester |
| P5 | Kegel (internal) | Pelvic floor | Reps, Hold | All stages |

### ✅ Added — Face & Jaw Mobility (Desk Stress)

| # | Exercise | Purpose | MediaPipe |
|---|---|---|---|
| F1 | Jaw Circles | TMJ release | ❌ Too subtle |
| F2 | Eye Palming | Eye strain relief | ❌ No landmarks |
| F3 | Face Yoga (forehead, cheeks) | Circulation | ❌ Too subtle |

### ✅ Added — Desk / Office Micro-Exercises

| # | Exercise | Track | MediaPipe |
|---|---|---|---|
| O1 | Seated Thoracic Extension | Duration | ✅ 100% |
| O2 | Shoulder Blade Squeeze | Reps | ✅ 100% |
| O3 | Neck Half-Circles | Reps | ✅ 100% |
| O4 | Seated Figure-4 Stretch | Hold duration | ✅ 100% |
| O5 | Standing Hip Flexor Release | Hold duration | ✅ 100% |
| O6 | Wrist Flexor/Extensor Stretch | Hold duration | ✅ 100% |
| O7 | Chest Opener (arm circles) | Reps | ✅ 100% |
| O8 | 20-20-20 Eye Rest | Timer | ❌ No tracking needed |

---

## Final Library Count Summary

| Category | Exercises | MediaPipe 100% | Partial | Not Trackable |
|---|---|---|---|---|
| A — Strength: Compound | 8 | 4 | 4 | 0 |
| B — Strength: Isolation | 20 | 10 | 4 | 6 |
| C — Bodyweight & Home | 30 | 26 | 3 | 1 |
| D — Functional Training | 14 | 12 | 2 | 0 |
| E — Cardio & Conditioning | 18 | 5 | 6 | 7 |
| F — HIIT Protocols | 6 | 5 | 1 | 0 |
| G — Yoga: Standing & Flow | 43 | 35 | 7 | 1 |
| H — Yin Yoga | 13 | 6 | 6 | 1 |
| I — Pilates | 18 | 14 | 3 | 1 |
| J — Mobility & Flexibility | 36 | 28 | 7 | 1 |
| K — Balance & Proprioception | 12 | 10 | 2 | 0 |
| L — Breathwork & Recovery | 10 | 0 | 1 | 9 |
| M — Sport-Specific | 13 | 13 | 0 | 0 |
| N — Calisthenics | 12 | 10 | 2 | 0 |
| SR — Senior / Rehab | 8 | 8 | 0 | 0 |
| P — Postnatal | 5 | 3 | 2 | 0 |
| O — Office / Desk | 8 | 7 | 0 | 1 |
| **TOTAL** | **274** | **196 (71%)** | **50 (18%)** | **28 (10%)** |

---

## Guidance Mode Assignment Rules

| Exercise Type | 📸 Image+Text | 🎬 Video+Audio | 📷 Camera Vision |
|---|---|---|---|
| Strength compound (squat, deadlift) | ✅ | ✅ | ⚠️ Partial |
| Bodyweight exercises | ✅ | ✅ | ✅ |
| Standing yoga poses | ✅ | ✅ | ✅ |
| Yin / restorative yoga | ✅ | ✅ | ⚠️ Partial |
| Breathwork | ✅ | ✅ (voice only) | ❌ |
| Cardio / running | ✅ | ✅ | ⚠️ Partial |
| Balance exercises | ✅ | ✅ | ✅ |
| Pilates | ✅ | ✅ | ✅ |
| Machine-based exercises | ✅ | ✅ | ❌ |
| Advanced calisthenics | ✅ | ✅ | ✅ |
| Office / desk exercises | ✅ | ✅ | ✅ |

---

*Document version: Kriya Mirror Fitness Library v1.0*
*Total exercises: 274 | MediaPipe 100% trackable: 196 (71%) | Requires side/overhead camera: 50 (18%) | Not trackable: 28 (10%)*

