import type { WarningType } from '@/store/workout';

export type WarningSeverity = 'normal' | 'urgent';

const STRINGS: Record<WarningType, { text: string; tone: 'amber' | 'danger' }> = {
  'heel-lift': { text: 'Keep your heels down', tone: 'amber' },
  valgus: { text: 'Knees out — don’t let them cave', tone: 'danger' },
  'trunk-forward': { text: 'Chest up, lean less forward', tone: 'amber' },
  'feet-narrow': { text: 'Feet a little wider', tone: 'amber' },
  'not-facing': { text: 'Face the camera', tone: 'amber' },
  'too-close': { text: 'Move back a step', tone: 'amber' },
  'too-far': { text: 'Move closer to the camera', tone: 'amber' },
  'not-moving': { text: 'Start the exercise — get into the pose', tone: 'amber' },
  'malformed-rep': { text: 'Slow down — control the descent', tone: 'amber' },
  // Hold-based
  'hip-sag': { text: 'Lift your hips — don’t let them sag', tone: 'amber' },
  'hip-pike': { text: 'Lower your hips — flatten your back', tone: 'amber' },
  'spine-misaligned': { text: 'Straighten your back — head to heels in one line', tone: 'amber' },
  'neck-droop': { text: 'Lift your chin slightly — neutral neck', tone: 'amber' },
  'hold-broken': { text: 'Hold broken — try again when ready', tone: 'danger' },
  // Push-up specific
  'elbow-flare': { text: 'Tuck your elbows — keep them ~45° from your body', tone: 'amber' },
  'incomplete-pushup': { text: 'Go deeper — chest closer to the floor', tone: 'amber' },
  // Lunge specific
  'knee-past-toe': { text: 'Front knee past toes — step further forward', tone: 'amber' },
  'incomplete-lunge': { text: 'Lower further — front thigh closer to parallel', tone: 'amber' },
  // Balance specific
  swaying: { text: 'Steady up — focus on a fixed point ahead', tone: 'amber' },
  'feet-separated': { text: 'Feet drifting apart — reset heel-to-toe', tone: 'amber' },
  // Used by bicep-curl and other rep-based engines that detect momentum cheats.
  // 2026-05-28 round 20: neutralized text (was bicep-specific).
  'torso-swing': { text: 'Stop swinging — use your muscles, not momentum', tone: 'amber' },
  'elbow-drift': { text: 'Pin elbows to your ribs — don’t let them drift forward', tone: 'amber' },
  'incomplete-curl': { text: 'Curl higher — bring the weight to your shoulder', tone: 'amber' },
  // Single-leg balance specific
  'hip-tilted': { text: 'Level your hips — don’t let the lifted side drop', tone: 'amber' },
  // Cross-cutting tracking-validity
  'position-lost': { text: 'Step back into the camera — we lost you', tone: 'danger' },
  // Tandem-stand coaching cue (subtle — never escalates)
  'hands-off-hips': { text: 'Hands back to your hips', tone: 'amber' },
  // Single-leg stand: lifted foot landed; recover by lifting back up
  'foot-dropped': { text: 'Lift your leg back up — foot dropped', tone: 'amber' },
  // Chair pose: knees coming up out of the hold (recoverable)
  'knee-too-straight': { text: 'Sink deeper — bend your knees more', tone: 'amber' },
  // Chair pose: torso leaning too far forward (recoverable)
  'torso-too-forward': { text: 'Chest up — sit back into your heels', tone: 'amber' },
  // Chair pose: sunk past chair pose into a full squat (recoverable)
  'knee-too-deep': { text: "Rise up — don't squat so deep", tone: 'amber' },
  // Lateral raise: half-rep, didn't reach shoulder height
  'incomplete-raise': { text: 'Raise higher — arms to shoulder height', tone: 'amber' },
  // Lateral raise: arms uneven (one lagged the other)
  'arm-asymmetry': { text: 'Both arms together — even raise', tone: 'amber' },
  // Tree pose: lifted foot drifted off the standing leg (recoverable)
  'foot-off-leg': { text: 'Press your foot into your standing leg', tone: 'amber' },
  // Warrior II: front knee not bent enough (standing too tall)
  'front-knee-not-bent-enough': { text: 'Sink lower — bend front knee more', tone: 'amber' },
  // Warrior II: front knee past 90° (going too deep)
  'front-knee-bent-too-much': { text: "Rise up — don't go past 90°", tone: 'amber' },
  // Warrior II: back leg bending (should stay straight)
  'back-knee-bent': { text: 'Straighten your back leg', tone: 'amber' },
  // Mountain Pose: combined posture misalignment
  'posture-not-aligned': { text: 'Stand tall — align your posture', tone: 'amber' },
  // Calf raise: rep complete but peak heel-rise didn't clear MIN_REP_DEPTH_PCT
  'low-heel-rise': { text: 'Push higher onto your toes — full heel rise', tone: 'amber' },
  // Jumping jacks: half-jack — peak arm OR leg openness didn't clear MIN_REP_OPENNESS_PCT
  'incomplete-jack': { text: 'Arms higher overhead and feet wider apart', tone: 'amber' },
  // High knees: shallow knee lift — peak knee elevation didn't clear MIN_REP_HEIGHT_PCT
  'low-knee-lift': { text: 'Drive your knees higher — aim for hip level', tone: 'amber' },
  // Goddess Pose: knees collapsing inward of the ankle line (valgus)
  'knees-caving': { text: 'Knees out — press them over your toes', tone: 'amber' },
  // Goddess Pose: elbows fell below shoulder height (cactus arms broken)
  'arms-dropped': { text: 'Lift your elbows back up to shoulder height', tone: 'amber' },
  // Triangle Pose: either knee bending — both legs should stay straight
  'leg-not-straight': { text: 'Straighten your legs — no bend in the knees', tone: 'amber' },
  // Triangle Pose: top arm tilting forward or back from vertical
  'top-arm-not-vertical': { text: 'Top arm straight up — reach for the sky', tone: 'amber' },
  // Triangle Pose: back hip rolling forward — should stack over the front hip
  'bottom-arm-not-down': { text: 'Bottom hand down — reach toward your front foot', tone: 'amber' },
  // Round 19: Lateral Raise restrictions + Mountain Pose runtime gates
  'arms-too-high': { text: "Stop at shoulder height — don't go overhead", tone: 'amber' },
  'arms-forward-not-side': { text: 'Out to the sides — not forward', tone: 'amber' },
  'arms-out-not-front': { text: 'Forward — not out to the sides', tone: 'amber' },
  // Round 22: Calf raise (heel-rise hold)
  'heel-dropped': { text: 'Heels back up — hold it', tone: 'amber' },
  'arms-not-overhead': { text: 'Reach arms back up overhead', tone: 'amber' },
  // Side leg raise: half-rep, didn't abduct far enough
  'low-leg-raise': { text: 'Lift your leg higher — out to the side', tone: 'amber' },
  // Oblique side bend: half-rep, didn't bend far enough
  'incomplete-bend': { text: 'Bend further over to the side', tone: 'amber' },
  // Sit-to-stand: started rising but sat back down without standing
  'incomplete-stand': { text: 'Stand all the way up', tone: 'amber' },
  // Warrior III: torso too upright / back leg dropped
  'torso-not-level': { text: 'Hinge forward — chest level into the T', tone: 'amber' },
  'back-leg-low': { text: 'Lift your back leg higher', tone: 'amber' },
  'legs-dropped': { text: 'Lift your legs back up into the V', tone: 'amber' },
  'chest-dropped': { text: 'Lift your chest — lean back into the boat', tone: 'amber' },
  // Standing Forward Fold: torso came up out of the fold (recoverable)
  'not-folded-enough': { text: 'Fold deeper — hinge further from the hips', tone: 'amber' },
  // Cobra Pose: chest dropped toward the floor (recoverable)
  'chest-not-lifted': { text: 'Lift your chest higher — press through your hands', tone: 'amber' },
  // Cat-Cow: a cycle didn't move through a full spinal range
  'shallow-spine-rom': { text: 'Arch and round your back through a fuller range', tone: 'amber' },
  // Downward Dog: arms bending (recoverable — straighten them)
  'arms-not-straight': { text: 'Straighten your arms — press the floor away', tone: 'amber' },
  // ── New exercises (Bilal's round 2) ──
  // Kettlebell Swing
  'squat-pattern': { text: 'Drive from your hips — this is a hinge, not a squat', tone: 'amber' },
  'arm-lift': { text: 'Let your arms swing passively — power comes from your hips', tone: 'amber' },
  'incomplete-extension': { text: 'Snap your hips fully — stand tall and squeeze your glutes at the top', tone: 'amber' },
  // Burpee
  'no-jump': { text: 'Finish with a jump — explode up at the end', tone: 'amber' },
  'incomplete-plank': { text: 'Get into full plank — extend your legs before pushing back up', tone: 'amber' },
  // Box Jump
  'stiff-landing': { text: 'Bend your knees on landing — absorb the impact softly', tone: 'danger' },
  'no-loading': { text: 'Dip first — bend your knees to load before jumping', tone: 'amber' },
  'incomplete-jump': { text: 'Jump higher — get full extension off the ground', tone: 'amber' },
  // Mountain Climber
  'incomplete-drive': { text: 'Drive your knee all the way to your chest for a full rep', tone: 'amber' },
  // Lateral Raise
  'above-parallel': { text: 'Lower your arms slightly — raise only to shoulder height', tone: 'amber' },
  // Star Jump
  'incomplete-star-jump': { text: 'Raise your arms fully overhead — reach all the way up', tone: 'amber' },
  // Glute Bridge
  'incomplete-bridge': { text: 'Drive your hips higher — squeeze your glutes at the top', tone: 'amber' },
  // Overhead Tricep Extension
  'incomplete-tricep-extension': { text: 'Lower further — bring the weight deeper behind your head', tone: 'amber' },
  // Chair Dip
  'incomplete-dip': { text: 'Dip lower — bend your elbows to 90°', tone: 'amber' },
  // Dead Bug
  'hip-lift-off': { text: 'Press your lower back into the mat — hips lifting', tone: 'danger' },
  'incomplete-dead-bug': { text: 'Extend further — straighten your leg closer to the floor', tone: 'amber' },
  // Inchworm
  'incomplete-inchworm': { text: 'Fold deeper — reach your hands closer to the floor', tone: 'amber' },
  // Jump Squat
  'incomplete-jump-squat': { text: 'Jump higher — push through the full range', tone: 'amber' },
  // Shrug
  'incomplete-shrug': { text: 'Shrug higher — elevate your shoulders fully', tone: 'amber' },
  // Superman
  'incomplete-superman': { text: 'Lift higher — chest and legs off the floor', tone: 'amber' },
  // Bird-Dog
  'incomplete-bird-dog': { text: 'Extend further — straighten your arm and leg fully', tone: 'amber' },
  // Step-Up
  'incomplete-step-up': { text: 'Drive higher — push all the way up onto the step', tone: 'amber' },
  // Walking Lunge
  'incomplete-walking-lunge': { text: 'Lower further — front thigh closer to parallel', tone: 'amber' },
  // Reverse Fly
  'incomplete-reverse-fly': { text: 'Raise higher — lift both arms to shoulder height', tone: 'amber' },
  // Goblet Squat
  'goblet-elbows-collapsing': { text: 'Spread elbows apart — push them outward', tone: 'amber' },
  'incomplete-goblet-squat': { text: 'Squat deeper — reach hip level', tone: 'amber' },
  // Donkey Kick
  'incomplete-donkey-kick': { text: 'Kick higher — drive heel toward the ceiling', tone: 'amber' },
  // Fire Hydrant
  'incomplete-fire-hydrant': { text: 'Lift higher — raise your knee out to the side', tone: 'amber' },
  // Curtsy Lunge
  'incomplete-curtsy-lunge': { text: 'Lower deeper — rear knee closer to the floor', tone: 'amber' },
  'hip-rotation-curtsy': { text: "Keep hips square — don't let the hip swing out", tone: 'amber' },
  'trunk-lean': { text: 'Stand taller — keep your torso upright', tone: 'amber' },
  'knee-valgus': { text: "Knees out — don't let them cave in", tone: 'danger' },
  // Pallof Press
  'incomplete-pallof-press': { text: 'Press fully — arms straight out from chest', tone: 'amber' },
  'torso-rotation-pallof': { text: 'Resist the pull — keep your torso facing forward', tone: 'danger' },
  // Lateral Band Walk
  'steps-not-tracked': { text: 'Stay in frame — take smaller steps sideways', tone: 'amber' },
  'hip-drop': { text: "Level your hips — don't let them drop to the side", tone: 'amber' },
  // Pistol Squat
  'incomplete-pistol-squat': { text: 'Go deeper on the squat', tone: 'amber' },
  // Nordic Curl
  'incomplete-nordic-curl': { text: 'Lower further for a full rep', tone: 'amber' },
  // Clamshell
  'incomplete-clamshell': { text: 'Open your knee higher', tone: 'amber' },
  // Strength exercises (integrated from Bilal's repo)
  'rounded-back': { text: 'Keep your back straight — don\'t round', tone: 'danger' },
  'hips-shooting-up': { text: 'Hips and shoulders rise together', tone: 'danger' },
  'incomplete-deadlift': { text: 'Hinge deeper — push your hips back further', tone: 'amber' },
  'shoulder-shrug': { text: 'Drop your shoulders — pull with your lats', tone: 'amber' },
  'incomplete-pullup': { text: 'Pull higher — chin over the bar', tone: 'amber' },
  'lower-back-arch': { text: 'Brace your core — don\'t arch your lower back', tone: 'danger' },
  'bar-path-drift': { text: 'Press straight up — keep the bar on a vertical path', tone: 'amber' },
  'incomplete-press': { text: 'Lock out fully — extend your elbows at the top', tone: 'amber' },
  'row-momentum': { text: 'Slow down — control the pull, no momentum', tone: 'amber' },
  'incomplete-row': { text: 'Pull higher — bring the bar to your torso', tone: 'amber' },
  'rdl-back-rounded': { text: 'Keep your back straight — don\'t round it', tone: 'danger' },
  'excessive-knee-bend': { text: 'Keep knees soft but fixed — don\'t squat down', tone: 'amber' },
  'incomplete-rdl': { text: 'Hinge deeper — push your hips back further', tone: 'amber' },
};

const URGENT_OVERRIDE: Record<WarningType, string> = {
  'heel-lift': 'Stop — heels rising every rep. Reset and try again',
  valgus: 'Stop — knees buckling. Reset your stance',
  'trunk-forward': 'Stop — torso collapsing. Reset and try again',
  'feet-narrow': 'Stop — feet drifting too narrow',
  'not-facing': 'Turn to face the camera',
  'too-close': 'Step back further',
  'too-far': 'Step closer in',
  'not-moving': 'Start moving — get into the pose / begin your reps',
  'malformed-rep': 'Stop — control the descent',
  'hip-sag': 'Stop — hips too low. Reset and lift up',
  'hip-pike': 'Stop — hips too high. Reset flat',
  'spine-misaligned': 'Stop — body line is wrong. Reset',
  'neck-droop': 'Lift your head',
  'hold-broken': 'Hold ended',
  'elbow-flare': 'Stop — elbows flaring every rep. Tuck them in',
  'incomplete-pushup': 'Stop — reps too shallow. Go deeper',
  'knee-past-toe': 'Stop — front knee well past toes. Step further forward',
  'incomplete-lunge': 'Stop — lunges too shallow. Lower further',
  swaying: 'Stop — too much sway. Reset and focus on a fixed point',
  'feet-separated': 'Stop — feet out of stance. Reset heel-to-toe',
  'torso-swing': 'Stop swinging your torso — strict reps only',
  'elbow-drift': 'Stop — elbows leaving your ribs every rep. Pin them',
  'incomplete-curl': 'Stop — curls too shallow. Bring it to your shoulder',
  'hip-tilted': 'Stop — hip dropping. Engage your glute and level your hips',
  'position-lost': 'Step back into frame NOW — we still can’t see you',
  'hands-off-hips': 'Hands back to your hips',
  'foot-dropped': 'Lift your leg back up — foot dropped',
  'knee-too-straight': 'Stop — knees straightening up. Sink back into the chair',
  'torso-too-forward': 'Stop — leaning too far forward. Reset upright',
  'knee-too-deep': 'Stop — too deep. Rise up to chair pose',
  'incomplete-raise': 'Stop — reps too shallow. Raise arms to shoulder height',
  'arm-asymmetry': 'Stop — arms uneven every rep. Both arms together',
  'foot-off-leg': 'Stop — foot drifting off the leg. Reset and press it back',
  'front-knee-not-bent-enough': 'Stop — front knee too straight. Sink into the warrior',
  'front-knee-bent-too-much': 'Stop — too deep. Bring front knee back to 90°',
  'back-knee-bent': 'Stop — back leg bending. Straighten it',
  'posture-not-aligned': 'Stop — posture drifting. Reset alignment',
  'low-heel-rise': 'Stop — heels barely rising. Push all the way up onto your toes',
  'incomplete-jack': 'Stop — half-jacks. Arms fully overhead and feet wider on every rep',
  'low-knee-lift': 'Stop — knees barely lifting. Drive them up to your hips on every rep',
  'knees-caving': 'Stop — knees collapsing inward. Press them out over your toes',
  'arms-dropped': 'Stop — elbows dropping. Hold them up at shoulder height',
  'leg-not-straight': 'Stop — knee bending. Both legs should stay straight in triangle',
  'top-arm-not-vertical': 'Stop — top arm tilting. Reach it straight up to the sky',
  'bottom-arm-not-down': 'Stop — bottom arm not reaching. Lower it toward the front foot',
  // Round 19
  'arms-too-high': 'Stop — arms going overhead. Halt at shoulder height',
  'arms-forward-not-side': 'Stop — arms going forward. Raise OUT to the sides',
  'arms-out-not-front': 'Stop — arms going out laterally. Raise them FORWARD in front',
  'heel-dropped': 'Stay up. Don\'t let your heels drop.',
  'arms-not-overhead': 'Stop — arms dropping. Reach back up to the ceiling',
  'low-leg-raise': 'Stop — leg barely lifting. Raise it higher out to the side every rep',
  'incomplete-bend': 'Stop — barely bending. Reach further down your side every rep',
  'incomplete-stand': 'Stop — half-rising. Push all the way up to standing each rep',
  'torso-not-level': 'Stop — chest too high. Hinge forward into a level airplane T',
  'back-leg-low': 'Stop — back leg dropping. Lift it up in line with your torso',
  'legs-dropped': 'Stop — legs sinking. Lift them back up into the boat V',
  'chest-dropped': 'Stop — chest collapsing. Lift up and lean back into the boat',
  'not-folded-enough': 'Fold deeper — hinge further forward from the hips',
  'chest-not-lifted': 'Lift your chest higher — press through your hands',
  'shallow-spine-rom': 'Move bigger — really arch and round your back each rep',
  'arms-not-straight': 'Stop — arms bending. Straighten them and press the floor away',
  // New exercises (Bilal's round 2)
  'squat-pattern': 'Stop — squatting instead of hinging. Drive from your hips',
  'arm-lift': 'Stop — arms doing the work. Let hips generate the power',
  'incomplete-extension': 'Stop — not locking out. Snap your hips fully at the top',
  'no-jump': 'Stop — missing the jump. Explode up at the end of every burpee',
  'incomplete-plank': 'Stop — not reaching full plank. Extend your legs before pushing up',
  'stiff-landing': 'Stop — stiff landing every rep. Bend your knees to absorb the impact',
  'no-loading': 'Stop — not loading first. Dip your knees before every jump',
  'incomplete-jump': 'Stop — jumps too short. Get full extension off the ground',
  'incomplete-drive': 'Stop — knee not reaching chest. Drive it all the way in',
  'above-parallel': 'Stop — arms going overhead. Halt at shoulder height',
  'incomplete-star-jump': 'Stop — arms not reaching overhead. Raise them all the way up',
  'incomplete-bridge': 'Stop — hips not high enough. Drive up and squeeze your glutes',
  'incomplete-tricep-extension': 'Stop — not going deep enough. Lower further behind your head',
  'incomplete-dip': 'Stop — not dipping to 90°. Bend your elbows more on every rep',
  'hip-lift-off': 'Stop — lower back lifting off the mat. Press it down and reset',
  'incomplete-dead-bug': 'Stop — limbs too high. Extend your leg closer to the floor',
  'incomplete-inchworm': 'Stop — not folding enough. Reach your hands further down',
  'incomplete-jump-squat': 'Stop — jumps too short. Push through a bigger range',
  'incomplete-shrug': 'Stop — shrugs too shallow. Elevate your shoulders all the way up',
  'incomplete-superman': 'Stop — not lifting enough. Get chest and legs fully off the floor',
  'incomplete-bird-dog': 'Stop — limbs not extending. Straighten arm and leg fully',
  'incomplete-step-up': 'Stop — not stepping all the way up. Push to full height',
  'incomplete-walking-lunge': 'Stop — lunges too shallow. Lower your back knee further',
  'incomplete-reverse-fly': 'Stop — arms too low. Raise both arms to shoulder height',
  'goblet-elbows-collapsing': 'Stop — elbows collapsing inward. Push them out on every rep',
  'incomplete-goblet-squat': 'Stop — squats too shallow. Reach hip depth every rep',
  'incomplete-donkey-kick': 'Stop — kick too low. Drive your heel all the way up',
  'incomplete-fire-hydrant': 'Stop — not abducting enough. Raise your knee higher out to the side',
  'incomplete-curtsy-lunge': 'Stop — lunges too shallow. Lower your rear knee closer to the floor',
  'hip-rotation-curtsy': 'Stop — hip swinging out. Keep both hips square',
  'trunk-lean': 'Stop — leaning too much. Keep your torso tall and upright',
  'knee-valgus': 'Stop — knees caving in. Drive them outward on every rep',
  'incomplete-pallof-press': 'Stop — not fully extending. Press arms all the way out from chest',
  'torso-rotation-pallof': 'Stop — torso rotating. Resist the band and stay square',
  'steps-not-tracked': 'Stop — stepping out of frame. Take smaller, controlled steps',
  'hip-drop': 'Stop — hips dropping. Keep them level throughout the walk',
  'incomplete-pistol-squat': 'Stop — not reaching depth. Go deeper on each rep',
  'incomplete-nordic-curl': 'Stop — not lowering far enough. Control the descent further',
  'incomplete-clamshell': 'Stop — not opening enough. Lift your knee higher every rep',
  // Strength exercises (integrated from Bilal's repo)
  'rounded-back': 'Stop — back rounding every rep. Reset and brace your core',
  'hips-shooting-up': 'Stop — hips shooting up. Drive through your legs equally',
  'incomplete-deadlift': 'Stop — reps too shallow. Hinge deeper each time',
  'shoulder-shrug': 'Stop — shoulders shrugging every rep. Depress your scapulae',
  'incomplete-pullup': 'Stop — chin not clearing the bar. Pull all the way up',
  'lower-back-arch': 'Stop — back arching every rep. Brace harder and reset',
  'bar-path-drift': 'Stop — bar drifting off vertical. Control the path',
  'incomplete-press': 'Stop — not locking out. Extend your elbows fully at the top',
  'row-momentum': 'Stop — using momentum. Slow it down',
  'incomplete-row': 'Stop — rows too shallow. Pull all the way to your torso',
  'rdl-back-rounded': 'Stop — back rounding every rep. Brace your core and reset',
  'excessive-knee-bend': 'Stop — knees bending too much. Keep them soft and still',
  'incomplete-rdl': 'Stop — hinge not deep enough. Push hips further back',
};

interface Props {
  type: WarningType;
  severity?: WarningSeverity;
}

export function PostureWarningChip({ type, severity = 'normal' }: Props) {
  const s = STRINGS[type];
  const text = severity === 'urgent' ? URGENT_OVERRIDE[type] : s.text;
  const bg = severity === 'urgent' || s.tone === 'danger' ? 'bg-overlay-danger' : 'bg-overlay-amber';
  const color = severity === 'urgent' || s.tone === 'danger' ? 'text-white' : 'text-amber-100';
  return (
    <div
      className={`${bg} rounded-xl px-5 py-3 max-w-[88vw] sm:max-w-md animate-slide-in-up`}
      role="alert"
    >
      <div className={`text-warning ${color}`}>{text}</div>
    </div>
  );
}
