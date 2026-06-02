'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCamera } from '@/lib/mediapipe/use-camera';
import { usePoseDetector } from '@/lib/mediapipe/use-pose';
import { useWorkout, type WarningType } from '@/store/workout';
import { SquatEngine } from '@/modules/squat/engine';
import { PlankEngine } from '@/modules/plank/engine';
import { SidePlankEngine } from '@/modules/side-plank/engine';
import { BoatPoseEngine } from '@/modules/boat-pose/engine';
import { PushupEngine } from '@/modules/pushup/engine';
import { LungeEngine } from '@/modules/lunge/engine';
import { TandemStandEngine } from '@/modules/tandem-stand/engine';
import { BicepCurlEngine } from '@/modules/bicep-curl/engine';
import { SingleLegStandEngine } from '@/modules/single-leg-stand/engine';
import { StarPoseEngine } from '@/modules/star-pose/engine';
import { StandingFigure4Engine } from '@/modules/standing-figure-4/engine';
import { GatePoseEngine } from '@/modules/gate-pose/engine';
import { ChairPoseEngine } from '@/modules/chair-pose/engine';
import { LateralRaiseEngine } from '@/modules/lateral-raise/engine';
import { TreePoseEngine } from '@/modules/tree-pose/engine';
import { WarriorTwoEngine } from '@/modules/warrior-2/engine';
import { WarriorOneEngine } from '@/modules/warrior-1/engine';
import { WarriorThreeEngine } from '@/modules/warrior-3/engine';
import { MountainPoseEngine } from '@/modules/mountain-pose/engine';
import { CalfRaiseEngine } from '@/modules/calf-raise/engine';
import { JumpingJacksEngine } from '@/modules/jumping-jacks/engine';
import { HighKneesEngine } from '@/modules/high-knees/engine';
import { FrontRaiseEngine } from '@/modules/front-raise/engine';
import { ArmCirclesEngine } from '@/modules/arm-circles/engine';
import { GoddessPoseEngine } from '@/modules/goddess-pose/engine';
import { TrianglePoseEngine } from '@/modules/triangle-pose/engine';
import { WallSitEngine } from '@/modules/wall-sit/engine';
import { SideLegRaiseEngine } from '@/modules/side-leg-raise/engine';
import { StandingLegSwingEngine } from '@/modules/standing-leg-swing/engine';
import { CatCowEngine } from '@/modules/cat-cow/engine';
import { SideBendEngine } from '@/modules/oblique-side-bend/engine';
import { ReverseLungeEngine } from '@/modules/reverse-lunge/engine';
import { LateralLungeEngine } from '@/modules/lateral-lunge/engine';
import { CossackSquatEngine } from '@/modules/cossack-squat/engine';
import { SitToStandEngine } from '@/modules/sit-to-stand/engine';
import { StandingForwardFoldEngine } from '@/modules/standing-forward-fold/engine';
import { DownwardDogEngine } from '@/modules/downward-dog/engine';
import { CobraPoseEngine } from '@/modules/cobra-pose/engine';
import { SeatedMarchEngine } from '@/modules/seated-march/engine';
import { SeatedForwardFoldEngine } from '@/modules/seated-forward-fold/engine';
// Strength exercises (integrated from Bilal's repo)
import { ConventionalDeadliftEngine } from '@/modules/conventional-deadlift/engine';
import { PullUpEngine } from '@/modules/pull-up/engine';
import { OverheadPressEngine } from '@/modules/overhead-press/engine';
import { BarbellRowEngine } from '@/modules/barbell-row/engine';
import { RomanianDeadliftEngine } from '@/modules/romanian-deadlift/engine';
import type { CalibrationUpdate, FrameMetrics } from '@/modules/squat/types';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { ExerciseEngine } from '@/modules/engine-interface';
import { HUD } from '@/components/HUD';
import { HoldTimer } from '@/components/HoldTimer';
import { PostureWarningChip, type WarningSeverity } from '@/components/PostureWarningChip';
import { RestCountdown } from '@/components/RestCountdown';
import { AudioToggle } from '@/components/AudioToggle';
import {
  playCalibrationBeep, playGoBeep, playRepComplete, playSetComplete,
  playWarningBeep, playRestStart, unlockAudio,
} from '@/lib/audio/cues';
import { speak, shutdownVoice, type VoicePriority } from '@/lib/audio/voice';
import { shouldSpeakNow, IMMEDIATE_AUDIO_WARNINGS } from '@/lib/audio/warning-policy';
import { syncAudioMuteFromStorage } from '@/lib/audio/preferences';

// Rule A — single visible warning, queue size 1, 3s minimum display + 1s gap
const WARNING_DISPLAY_MS = 3000;
const WARNING_GAP_MS = 1000;

// 2026-05-31 physical-test fix — graceful hold-end:
//  - END_ANNOUNCE_DELAY_MS: clean completion — speak "Hold complete" and show
//    the ending overlay for this long before navigating to the report.
//  - BROKEN_END_ANNOUNCE_DELAY_MS: when the hold is BROKEN (user stood up
//    mid-pose) the transition can feel abrupt. Give a longer beat so the
//    "Hold ended. Showing your report in a moment." line is clearly heard
//    and the user mentally registers the pose is over before the page flips.
//  - SUSTAINED_FREEZE_TERMINATE_MS: recoverable form-breaks freeze the timer;
//    but if the hold stays frozen (zero valid seconds gained) continuously for
//    this long after the user got into the pose, end the session gracefully.
const END_ANNOUNCE_DELAY_MS = 1800;
const BROKEN_END_ANNOUNCE_DELAY_MS = 3500;
const SUSTAINED_FREEZE_TERMINATE_MS = 12000;

interface CurrentWarning {
  type: WarningType;
  severity: WarningSeverity;
  shownAt: number;
}

const WARNING_PRIORITY: Record<WarningType, number> = {
  'hold-broken': 6,
  // 2026-05-25: position-lost is tracking-validity (most blocking after the
  // session actually ending). Sits just below hold-broken.
  'position-lost': 5,
  valgus: 5,
  'trunk-forward': 4,
  'malformed-rep': 4,
  'hip-sag': 4,
  'hip-pike': 4,
  'spine-misaligned': 4,
  'elbow-flare': 4,
  'knee-past-toe': 4,
  swaying: 4,
  'feet-separated': 4,
  'torso-swing': 4,
  'elbow-drift': 4,
  'hip-tilted': 4,
  'incomplete-pushup': 3,
  'incomplete-lunge': 3,
  'incomplete-curl': 3,
  'heel-lift': 3,
  'neck-droop': 3,
  'feet-narrow': 2,
  'not-facing': 2,
  'too-close': 1,
  'too-far': 1,
  'not-moving': 1,
  // 2026-05-25 round 9: tandem-stand subtle coaching cue. Sits below the
  // other warnings so a louder issue (sway, feet-separated) wins the chip slot.
  'hands-off-hips': 2,
  // 2026-05-25 round 11: single-leg stand foot-dropped (recoverable). Higher
  // priority than other form warnings — losing single-leg stance is the
  // primary thing to fix.
  'foot-dropped': 5,
  // Chair pose: both recoverable form-break warnings sit alongside the other
  // structural form warnings (hip-sag, spine-misaligned, etc.).
  'knee-too-straight': 4,
  'torso-too-forward': 4,
  'knee-too-deep': 4,
  // Lateral raise — sit alongside the other "incomplete rep" warnings at tier 3.
  'incomplete-raise': 3,
  'arm-asymmetry': 4,
  // Tree pose — foot-off-leg is the primary structural form-break. Slightly
  // higher than the other form warnings since losing the foot-on-leg position
  // is what defines Tree Pose as Tree Pose (vs SLS).
  'foot-off-leg': 5,
  // Warrior II — all 3 new warnings sit at form-tier 4 alongside the other
  // structural form warnings.
  'front-knee-not-bent-enough': 4,
  'front-knee-bent-too-much': 4,
  'back-knee-bent': 4,
  // Mountain Pose — combined alignment warning at the same form tier.
  'posture-not-aligned': 4,
  // Calf raise — shallow rep at the same tier as other "incomplete rep" warnings.
  'low-heel-rise': 3,
  // Jumping jacks — half-jack at the same tier as other "incomplete rep" warnings.
  'incomplete-jack': 3,
  // High knees — shallow knee lift at the same tier.
  'low-knee-lift': 3,
  // Goddess Pose — both new warnings sit at structural form-tier 4 alongside
  // the other reused goddess warnings (knee-too-straight, torso-too-forward).
  'knees-caving': 4,
  'arms-dropped': 4,
  // Triangle Pose — all 3 new warnings sit at structural form-tier 4.
  'leg-not-straight': 4,
  'top-arm-not-vertical': 4,
  'bottom-arm-not-down': 4,
  // Round 19: Lateral Raise restrictions + Mountain Pose runtime gates
  'arms-too-high': 4,
  'arms-forward-not-side': 4,
  'arms-out-not-front': 4,
  'heel-dropped': 4,
  'arms-not-overhead': 4,
  // Side leg raise — shallow abduction at the same tier as other "incomplete rep" warnings.
  'low-leg-raise': 3,
  // Oblique side bend — shallow bend at the same tier.
  'incomplete-bend': 3,
  // Sit-to-stand — aborted stand at the same "incomplete rep" tier.
  'incomplete-stand': 3,
  // Warrior III — posture cues (recoverable, freeze the timer) at the form tier.
  'torso-not-level': 4,
  'back-leg-low': 4,
  // Boat Pose — V cues (recoverable, freeze the timer) at the form tier.
  'legs-dropped': 4,
  'chest-dropped': 4,
  // Standing Forward Fold — recoverable depth cue (freezes the timer) at the form tier.
  'not-folded-enough': 4,
  // Cobra Pose — recoverable chest-lift cue (freezes the timer) at the form tier.
  'chest-not-lifted': 4,
  // Cat-Cow — shallow range-of-motion coaching cue (rep not counted).
  'shallow-spine-rom': 3,
  // Downward Dog — arms bending (recoverable, freezes the timer) at the form tier.
  'arms-not-straight': 4,
  // Strength exercises (integrated from Bilal's repo)
  'rounded-back': 4,
  'hips-shooting-up': 4,
  'incomplete-deadlift': 3,
  'shoulder-shrug': 4,
  'incomplete-pullup': 3,
  'lower-back-arch': 4,
  'bar-path-drift': 3,
  'incomplete-press': 3,
  'row-momentum': 4,
  'incomplete-row': 3,
  'rdl-back-rounded': 4,
  'excessive-knee-bend': 3,
  'incomplete-rdl': 3,
};

// 2026-05-25 Issue 2: voice coaching during calibration based on most-blocking
// gate. Keys match the MostBlockingGate union values.
const CALIB_GATE_SPEECH: Record<string, string> = {
  'no-body': 'Step into the frame so your whole body is visible.',
  'too-far': 'Step closer to the camera.',
  'too-close': 'Step back from the camera.',
  'feet-narrow': 'Spread your feet wider than your shoulders.',
  'arms-not-overhead': 'Raise both arms straight overhead.',
};

// On-screen banner label per failing gate (shorter than the spoken version).
const CALIB_GATE_HINT_LABEL: Record<string, string> = {
  'no-body': 'Step into the frame — full body needs to be visible',
  'too-far': 'Step closer to the camera',
  'too-close': 'Step back from the camera',
  'feet-narrow': 'Spread your feet wider than your shoulders',
  'arms-not-overhead': 'Raise both arms straight overhead',
};

const WARNING_SPEECH: Record<WarningType, string> = {
  'heel-lift': 'Keep your heels down.',
  valgus: 'Knees out. Don’t let them cave in.',
  'trunk-forward': 'Chest up. Lean less forward.',
  'feet-narrow': 'Stand with your feet a little wider.',
  'not-facing': 'Face the camera.',
  'too-close': 'Step back from the camera.',
  'too-far': 'Step closer to the camera.',
  'not-moving': 'Start the exercise. Get into the pose.',
  'malformed-rep': 'Slow down. Control the descent.',
  'hip-sag': 'Lift your hips. Don’t let them sag.',
  'hip-pike': 'Lower your hips. Flatten your back.',
  'spine-misaligned': 'Straighten your back.',
  'neck-droop': 'Lift your chin a little.',
  'hold-broken': 'Hold ended.',
  'elbow-flare': 'Tuck your elbows in.',
  'incomplete-pushup': 'Lower further. Chest to the floor.',
  'knee-past-toe': 'Front knee past your toes. Step further forward.',
  'incomplete-lunge': 'Lower further. Front thigh closer to parallel.',
  swaying: 'Steady up. Focus on a fixed point ahead.',
  'feet-separated': 'Reset your feet heel to toe.',
  'torso-swing': 'Stop swinging. Use your muscles, not momentum.',
  'elbow-drift': 'Keep your elbows pinned to your ribs.',
  'incomplete-curl': 'Curl higher. Bring it to your shoulder.',
  'hip-tilted': 'Level your hips. Don’t let the lifted side drop.',
  'position-lost': 'Step back into the camera. We can’t see you.',
  'hands-off-hips': 'Place your hands back on your hips.',
  'foot-dropped': 'Lift your foot back up.',
  'knee-too-straight': 'Sink deeper. Bend your knees more.',
  'torso-too-forward': 'Chest up. Sit back into your heels.',
  'knee-too-deep': "Rise up. Chair pose isn't a full squat.",
  'incomplete-raise': 'Raise higher. Arms to shoulder height.',
  'arm-asymmetry': 'Even out your arms. Both rising together.',
  'foot-off-leg': 'Press your foot into your standing leg.',
  'front-knee-not-bent-enough': 'Sink lower — bend the front knee more.',
  'front-knee-bent-too-much': "Rise up — don't go past 90°.",
  'back-knee-bent': 'Straighten your back leg.',
  'posture-not-aligned': 'Stand tall — shoulders down, spine long.',
  'low-heel-rise': 'Push higher onto your toes.',
  'incomplete-jack': 'Arms overhead and feet wider apart.',
  'low-knee-lift': 'Drive your knees higher — up to your hips.',
  'knees-caving': 'Knees out. Press them over your toes.',
  'arms-dropped': 'Lift your elbows back up to shoulder height.',
  'leg-not-straight': 'Straighten your legs. No bend in the knees.',
  'top-arm-not-vertical': 'Top arm straight up. Reach for the sky.',
  'bottom-arm-not-down': 'Bottom hand down. Reach toward your front foot.',
  // Round 19: Lateral Raise restrictions + Mountain Pose runtime gates
  'arms-too-high': "Stop at shoulder height. Don't raise arms overhead.",
  'arms-forward-not-side': 'Raise arms OUT to the sides. Not forward.',
  'arms-out-not-front': 'Raise arms FORWARD in front of you. Not out to the sides.',
  'heel-dropped': 'Stay up. Don\'t let your heels drop.',
  'arms-not-overhead': 'Reach your arms back up overhead.',
  'low-leg-raise': 'Lift your leg higher — out to the side.',
  'incomplete-bend': 'Bend further over to the side.',
  'incomplete-stand': 'Stand all the way up.',
  'torso-not-level': 'Hinge forward — lower your chest into a level T.',
  'back-leg-low': 'Lift your back leg higher, toward the ceiling.',
  'legs-dropped': 'Lift your legs back up into the V.',
  'chest-dropped': 'Lift your chest — lean back into the boat.',
  'not-folded-enough': 'Fold deeper. Hinge further forward from the hips.',
  'chest-not-lifted': 'Lift your chest higher.',
  'shallow-spine-rom': 'Move through a bigger range — arch and round your back more.',
  'arms-not-straight': 'Straighten your arms. Press the floor away.',
  // Strength exercises (integrated from Bilal's repo)
  'rounded-back': 'Keep your back straight. Do not round your spine.',
  'hips-shooting-up': 'Drive through your legs. Hips and shoulders rise together.',
  'incomplete-deadlift': 'Hinge deeper. Push your hips back further.',
  'shoulder-shrug': 'Drop your shoulders. Pull with your lats, not your traps.',
  'incomplete-pullup': 'Pull higher. Chin over the bar.',
  'lower-back-arch': 'Keep your core braced. Do not let your lower back arch.',
  'bar-path-drift': 'Press straight up — keep the bar on a vertical path.',
  'incomplete-press': 'Fully lock out your elbows at the top of each rep.',
  'row-momentum': 'Control the movement — do not rock your body to pull the weight.',
  'incomplete-row': 'Drive your elbows higher to get full back contraction.',
  'rdl-back-rounded': 'Keep your back flat. Hinge from the hips, not the spine.',
  'excessive-knee-bend': 'Keep your knees soft but fixed. Do not squat down.',
  'incomplete-rdl': 'Hinge deeper. Push your hips back further.',
};

export default function PlayPage({ params }: { params: { exerciseId: string } }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ExerciseEngine | null>(null);

  const camera = useCamera();
  const pose = usePoseDetector();

  const exercise = useWorkout((s) => s.exercise);
  const setup = useWorkout((s) => s.setup);
  const status = useWorkout((s) => s.status);
  const sets = useWorkout((s) => s.sets);
  const currentSetIndex = useWorkout((s) => s.currentSetIndex);
  const restEndsAt = useWorkout((s) => s.restEndsAt);
  const recordRep = useWorkout((s) => s.recordRep);
  const completeSet = useWorkout((s) => s.completeSet);
  const startRest = useWorkout((s) => s.startRest);
  const skipRest = useWorkout((s) => s.skipRest);
  const holdRecord = useWorkout((s) => s.holdRecord);
  const recordHoldTick = useWorkout((s) => s.recordHoldTick);
  const completeHold = useWorkout((s) => s.completeHold);
  const manualEndWorkout = useWorkout((s) => s.manualEndWorkout);
  // Track when engine was instantiated so timeout-retry can recreate it.
  const [engineNonce, setEngineNonce] = useState(0);

  const isHoldBased = exercise?.exerciseType === 'hold-based';

  const [calibration, setCalibration] = useState<CalibrationUpdate | null>(null);
  const [latestFrame, setLatestFrame] = useState<FrameMetrics | null>(null);
  const [currentWarning, setCurrentWarning] = useState<CurrentWarning | null>(null);
  const pendingWarningRef = useRef<{ type: WarningType; severity: WarningSeverity } | null>(null);
  const lastClearedAtRef = useRef(0);
  const [bootError, setBootError] = useState<string | null>(null);
  // Per-set per-type occurrence counts (drives severity escalation 1→2→3+)
  const setWarningCountsRef = useRef<Partial<Record<WarningType, number>>>({});

  // Graceful hold-end (announce-then-navigate + sustained-freeze terminate).
  const [ending, setEnding] = useState(false);
  const finishingRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartedRef = useRef(false);        // user actually entered the pose (secondsElapsed ≥ 1)
  const lastAdvanceSecRef = useRef(-1);        // highest secondsElapsed seen
  const lastAdvanceAtRef = useRef(0);          // wall-clock when secondsElapsed last advanced

  // Sync localStorage mute state into the module-level mirror once on mount.
  useEffect(() => { syncAudioMuteFromStorage(); }, []);

  useEffect(() => {
    if (!exercise || !setup) router.replace(params.exerciseId ? `/${params.exerciseId}` : '/');
  }, [exercise, setup, router, params.exerciseId]);

  useEffect(() => {
    if (status === 'complete') router.replace(`/${params.exerciseId}/report`);
  }, [status, router, params.exerciseId]);

  // Rule A — single-slot warning queue + severity escalation (Tier 3 #10).
  //   1st occurrence in set: amber chip + warning beep
  //   2nd occurrence in set: amber chip + beep + voice
  //   3rd+ in set:           urgent (red) chip + beep + urgent voice
  const handleWarning = useCallback((type: WarningType) => {
    const counts = setWarningCountsRef.current;
    counts[type] = (counts[type] ?? 0) + 1;
    const occurrenceInSet = counts[type]!;
    const severity: WarningSeverity = occurrenceInSet >= 3 ? 'urgent' : 'normal';
    let voicePriority: VoicePriority = occurrenceInSet >= 3 ? 'high'
      : occurrenceInSet >= 2 ? 'normal'
      : 'low';
    // 2026-05-28 round 21: navigation warnings (position-lost, distance, idle)
    // need to reach the user even on first occurrence — they describe a
    // physical position problem and the user may not see the chip.
    // First-occurrence formerly used 'low' priority, which can be evicted
    // from voice.ts's single `pending` slot if any other warning is queued.
    // Promote to 'normal' so the announcement actually speaks.
    if (IMMEDIATE_AUDIO_WARNINGS.has(type) && voicePriority === 'low') {
      voicePriority = 'normal';
    }

    // Sound + speech (Rule B handled inside cues.ts and voice.ts)
    playWarningBeep();
    // 2026-05-28 round 19: NAVIGATION warnings (position-lost, too-close,
    // too-far, not-moving) fire audio on FIRST occurrence — the user is
    // physically out of position and may not see the chip. FORM warnings
    // keep the "free pass on first occurrence" UX.
    if (shouldSpeakNow(type, occurrenceInSet)) {
      const utterance = severity === 'urgent'
        ? `Stop. ${WARNING_SPEECH[type]}`
        : WARNING_SPEECH[type];
      // 2026-05-31: ALL navigation warnings (position-lost, too-close,
      // too-far, not-moving) MUST reach the user since they describe a
      // physical position problem and the user may not see the chip. Use
      // force=true so the voice claims the pending slot even if another
      // normal-priority utterance is already queued, and (via voice.ts) so
      // the first fire bypasses the per-key cooldown. This makes the spoken
      // cue co-fire with the beep + chip instead of being dropped/delayed.
      // Subsequent fires still respect the 4 s per-key cooldown (anti-spam).
      const force = IMMEDIATE_AUDIO_WARNINGS.has(type);
      speak(utterance, voicePriority, type, { force });
    }

    const incoming = { type, severity };
    const now = Date.now();

    setCurrentWarning((current) => {
      if (!current) {
        if (now - lastClearedAtRef.current >= WARNING_GAP_MS) {
          return { ...incoming, shownAt: now };
        }
        pendingWarningRef.current = incoming;
        return null;
      }
      const incomingPriority = WARNING_PRIORITY[type];
      const currentPriority = WARNING_PRIORITY[current.type];
      if (incomingPriority > currentPriority) {
        return { ...incoming, shownAt: now };
      }
      const pending = pendingWarningRef.current;
      if (!pending || incomingPriority > WARNING_PRIORITY[pending.type]) {
        pendingWarningRef.current = incoming;
      }
      return current;
    });
  }, []);

  // Auto-rotate current warning out after display window; promote pending if any
  useEffect(() => {
    if (!currentWarning) return;
    const expiresIn = WARNING_DISPLAY_MS - (Date.now() - currentWarning.shownAt);
    const timer = setTimeout(() => {
      lastClearedAtRef.current = Date.now();
      const next = pendingWarningRef.current;
      if (next) {
        pendingWarningRef.current = null;
        // Schedule the gap before the next chip
        setTimeout(() => {
          setCurrentWarning({ ...next, shownAt: Date.now() });
        }, WARNING_GAP_MS);
        setCurrentWarning(null);
      } else {
        setCurrentWarning(null);
      }
    }, Math.max(100, expiresIn));
    return () => clearTimeout(timer);
  }, [currentWarning]);

  // Announce-then-navigate: speak the end cue (high + force so it isn't dropped),
  // show the "ending" overlay, and only navigate to the report after a short
  // delay so the spoken line is heard before the page unmounts / shutdownVoice().
  // `finishingRef` guards against a double-fire (engine hold-broken racing the
  // sustained-freeze terminate, or the target being reached at the same tick).
  const finishHold = useCallback((broken: boolean) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    if (broken) {
      speak('Hold ended. Showing your report in a moment.', 'high', 'hold-end', { force: true });
    } else {
      playSetComplete();
      speak('Hold complete. Great work.', 'high', 'hold-end', { force: true });
    }
    setEnding(true);
    const delayMs = broken ? BROKEN_END_ANNOUNCE_DELAY_MS : END_ANNOUNCE_DELAY_MS;
    endTimerRef.current = setTimeout(() => {
      completeHold(broken);
    }, delayMs);
  }, [completeHold]);

  const handleHoldTick = useCallback(
    (tick: { secondsElapsed: number; mqs: number; longestUnfrozenSec?: number }) => {
      recordHoldTick(tick.mqs, tick.secondsElapsed, tick.longestUnfrozenSec);

      // Track freeze progress for the sustained-freeze auto-terminate. The
      // counter only advances on valid (good-form) seconds, so a stalled
      // secondsElapsed means the form has been continuously broken.
      const nowMs = Date.now();
      if (tick.secondsElapsed >= 1) holdStartedRef.current = true;
      if (tick.secondsElapsed > lastAdvanceSecRef.current) {
        lastAdvanceSecRef.current = tick.secondsElapsed;
        lastAdvanceAtRef.current = nowMs;
      }

      const state = useWorkout.getState();
      const target = state.setup?.holdDurationSec ?? 0;
      if (target > 0 && tick.secondsElapsed >= target) {
        finishHold(false);
        return;
      }

      // Recoverable breaks just freeze; but a CONTINUOUS freeze (no valid second
      // gained) for SUSTAINED_FREEZE_TERMINATE_MS after the user got into the
      // pose ends the session gracefully (audio + overlay + report).
      if (
        holdStartedRef.current
        && lastAdvanceAtRef.current > 0
        && nowMs - lastAdvanceAtRef.current >= SUSTAINED_FREEZE_TERMINATE_MS
      ) {
        finishHold(true);
      }
    },
    [recordHoldTick, finishHold],
  );

  const handleHoldBroken = useCallback(() => {
    finishHold(true);
  }, [finishHold]);

  const handleRepComplete = useCallback(
    (rep: { depthDeg: number; smoothness: number; form: number; mqs: number; warnings: WarningType[] }) => {
      recordRep(rep);
      playRepComplete();

      const state = useWorkout.getState();
      const currentSet = state.sets[state.currentSetIndex];
      if (currentSet && currentSet.reps.length >= currentSet.plannedReps) {
        completeSet();
        playSetComplete();
        const isLastSet = state.currentSetIndex + 1 >= (state.setup?.plannedSets ?? 0);
        if (isLastSet) {
          useWorkout.getState().finishWorkout();
          speak('Workout complete. Great job.', 'normal');
        } else {
          startRest();
          playRestStart();
          speak(`Set ${state.currentSetIndex + 1} complete. Rest for ${state.setup?.restSec ?? 60} seconds.`, 'normal');
        }
      }
    },
    [recordRep, completeSet, startRest],
  );

  useEffect(() => {
    if (!exercise || !setup) return;
    let mounted = true;

    // Reset graceful-end state for this session (mount / timeout-retry / playAgain).
    finishingRef.current = false;
    holdStartedRef.current = false;
    lastAdvanceSecRef.current = -1;
    lastAdvanceAtRef.current = 0;
    setEnding(false);

    (async () => {
      try {
        await pose.init();
        if (!mounted) return;
        if (videoRef.current) await camera.start(videoRef.current);
        if (!mounted) return;

        let calibrationConfirmedFired = false;
        const calibrationDoneSpeech = exercise.exerciseType === 'hold-based'
          ? 'Calibrated. Hold the position.'
          : 'Calibrated. Begin your first set when ready.';

        const sharedCallbacks = {
          onCalibrationUpdate: (u: CalibrationUpdate) => {
            if (!mounted) return;
            setCalibration(u);
            if (!calibrationConfirmedFired && u.state === 'confirmed') {
              calibrationConfirmedFired = true;
              playCalibrationBeep();
              setTimeout(() => playGoBeep(), 400);
              speak(calibrationDoneSpeech, 'normal');
            }
          },
          onPostureWarning: (w: WarningType) => mounted && handleWarning(w),
        };

        if (exercise.engineModule === 'plank') {
          engineRef.current = new PlankEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'side-plank') {
          engineRef.current = new SidePlankEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'boat-pose') {
          engineRef.current = new BoatPoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'tandem-stand') {
          engineRef.current = new TandemStandEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'single-leg-stand') {
          engineRef.current = new SingleLegStandEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'star-pose') {
          engineRef.current = new StarPoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'standing-figure-4') {
          engineRef.current = new StandingFigure4Engine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'gate-pose') {
          engineRef.current = new GatePoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'tree-pose') {
          engineRef.current = new TreePoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'chair-pose') {
          engineRef.current = new ChairPoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'warrior-2') {
          engineRef.current = new WarriorTwoEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'warrior-1') {
          engineRef.current = new WarriorOneEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'warrior-3') {
          engineRef.current = new WarriorThreeEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'goddess-pose') {
          engineRef.current = new GoddessPoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'triangle-pose') {
          engineRef.current = new TrianglePoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'mountain-pose') {
          engineRef.current = new MountainPoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'wall-sit') {
          engineRef.current = new WallSitEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'standing-forward-fold') {
          engineRef.current = new StandingForwardFoldEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'downward-dog') {
          engineRef.current = new DownwardDogEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'cobra-pose') {
          engineRef.current = new CobraPoseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'seated-forward-fold') {
          engineRef.current = new SeatedForwardFoldEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'pushup') {
          engineRef.current = new PushupEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'lunge') {
          engineRef.current = new LungeEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'bicep-curl') {
          engineRef.current = new BicepCurlEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'lateral-raise') {
          engineRef.current = new LateralRaiseEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'calf-raise') {
          // 2026-05-28 round 22: calf-raise is now HOLD-based (heel-rise hold).
          const calfEngine = new CalfRaiseEngine({
            ...sharedCallbacks,
            onHoldTick: (t) => mounted && handleHoldTick(t),
            onHoldBroken: () => mounted && handleHoldBroken(),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
          const targetSec = useWorkout.getState().setup?.holdDurationSec;
          if (targetSec && targetSec > 0) calfEngine.setTargetDurationSec(targetSec);
          engineRef.current = calfEngine;
        } else if (exercise.engineModule === 'jumping-jacks') {
          engineRef.current = new JumpingJacksEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'high-knees') {
          engineRef.current = new HighKneesEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'seated-march') {
          engineRef.current = new SeatedMarchEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'side-leg-raise') {
          engineRef.current = new SideLegRaiseEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'standing-leg-swing') {
          engineRef.current = new StandingLegSwingEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'cat-cow') {
          engineRef.current = new CatCowEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'oblique-side-bend') {
          engineRef.current = new SideBendEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'reverse-lunge') {
          engineRef.current = new ReverseLungeEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'lateral-lunge') {
          engineRef.current = new LateralLungeEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'cossack-squat') {
          engineRef.current = new CossackSquatEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'sit-to-stand') {
          engineRef.current = new SitToStandEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'front-raise') {
          engineRef.current = new FrontRaiseEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'arm-circles') {
          engineRef.current = new ArmCirclesEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'conventional-deadlift') {
          engineRef.current = new ConventionalDeadliftEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'pull-up') {
          engineRef.current = new PullUpEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'overhead-press') {
          engineRef.current = new OverheadPressEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'romanian-deadlift') {
          engineRef.current = new RomanianDeadliftEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else if (exercise.engineModule === 'barbell-row') {
          engineRef.current = new BarbellRowEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f as unknown as FrameMetrics),
          });
        } else {
          engineRef.current = new SquatEngine({
            ...sharedCallbacks,
            onRepComplete: (r) => mounted && handleRepComplete(r),
            onFrame: (f) => mounted && setLatestFrame(f),
          });
        }

        if (videoRef.current) {
          pose.startDetection(videoRef.current, (landmarks, timestamp) => {
            if (!engineRef.current) return;
            engineRef.current.update(landmarks as PoseLandmarks | null, timestamp);
            drawSkeleton(landmarks);
          });
        }
      } catch (err) {
        setBootError(err instanceof Error ? err.message : 'Failed to start');
      }
    })();

    return () => {
      mounted = false;
      if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null; }
      pose.stopDetection();
      camera.stop();
      engineRef.current?.finish();
      shutdownVoice();
    };
    // engineNonce in deps so calibration-timeout retry recreates the engine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineNonce]);

  useEffect(() => {
    if (status === 'tracking' && engineRef.current) {
      engineRef.current.resetForNextSet();
      // Severity counter resets per set so the 1st of each warning type in a
      // fresh set is treated as "first occurrence" again.
      setWarningCountsRef.current = {};
    }
  }, [status]);

  // 2026-05-25 Issue 2: voice-coach the user during calibration based on which
  // gate is failing. Uses voice's built-in 4s rate-limit via the `key` arg.
  useEffect(() => {
    if (!calibration || calibration.state === 'confirmed') return;
    const blocker = calibration.mostBlockingGate;
    if (!blocker) return;
    const line = CALIB_GATE_SPEECH[blocker];
    if (line) speak(line, 'normal', `cal-${blocker}`);
  }, [calibration?.mostBlockingGate, calibration?.state]);

  // Idle hint during calibration — user is in frame but not moving for 5s+
  useEffect(() => {
    if (!calibration || calibration.state === 'confirmed') return;
    if ((calibration.idleHintMs ?? 0) > 0) {
      speak('Please move into position.', 'normal', 'cal-idle');
    }
  }, [calibration?.idleHintMs, calibration?.state]);

  // 2026-05-28: voice the distance hint during calibration even when the
  // engine doesn't populate `mostBlockingGate`. Most hold-based engines
  // (goddess, triangle, mountain, tree, …) emit `distanceHint` but skip
  // the `mostBlockingGate` field, so the existing CALIB_GATE_SPEECH effect
  // above never fires for them. This effect catches that case so the user
  // hears "Step closer / back from the camera" while the chip displays.
  // 4 s per-key cooldown in voice.ts prevents spam if the hint flickers.
  useEffect(() => {
    if (!calibration || calibration.state === 'confirmed') return;
    const hint = calibration.distanceHint;
    if (!hint) return;
    const line = CALIB_GATE_SPEECH[hint];
    if (line) speak(line, 'normal', `cal-${hint}`);
  }, [calibration?.distanceHint, calibration?.state]);

  // 2026-05-25 Issue 4: manual Complete button handler.
  const handleManualComplete = useCallback(() => {
    speak('Session ended manually.', 'high', 'manual-end');
    playSetComplete();
    manualEndWorkout();
    // The useEffect watching `status === 'complete'` will route to /<id>/report.
  }, [manualEndWorkout]);

  // Calibration-timeout retry: bump the nonce → main mount-effect's deps include
  // it, so a new engine is created and the camera detection loop restarts.
  const handleCalibrationRetry = useCallback(() => {
    setCalibration(null);
    setEngineNonce((n) => n + 1);
  }, []);

  function drawSkeleton(landmarks: PoseLandmarks | null) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;
    const pairs: [number, number][] = [
      [11, 12], [11, 23], [12, 24], [23, 24],
      [23, 25], [25, 27], [24, 26], [26, 28],
      [11, 13], [13, 15], [12, 14], [14, 16],
    ];
    ctx.strokeStyle = '#00E5CC';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#FFB547';
    ctx.beginPath();
    for (const [a, b] of pairs) {
      const la = landmarks[a]; const lb = landmarks[b];
      if (!la || !lb) continue;
      ctx.moveTo(la.x * canvas.width, la.y * canvas.height);
      ctx.lineTo(lb.x * canvas.width, lb.y * canvas.height);
    }
    ctx.stroke();
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!exercise || !setup) return null;

  const currentSet = sets[currentSetIndex];
  const mqs = currentSet?.mqs ?? 0;
  const repsThisSet = currentSet?.reps.length ?? 0;
  const calConfirmed = calibration?.state === 'confirmed';

  return (
    <main
      className="fixed inset-0 bg-black"
      onPointerDown={() => unlockAudio()}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ transform: 'scaleX(-1)' }}
      />

      {bootError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 z-50 px-4">
          <div className="bg-overlay rounded-xl p-8 max-w-md text-center">
            <h2 className="text-warning text-accent-danger mb-3">Camera or model failed to start</h2>
            <p className="text-base text-muted-foreground mb-5">{bootError}</p>
            <Link href={`/${exercise.id}`} className="text-accent-teal text-base font-semibold">
              ← Back to exercise
            </Link>
          </div>
        </div>
      )}

      {/* 2026-05-25 Issue 2d — calibration timeout: replace the live overlay
          with a centered retry card. */}
      {calibration?.state === 'timeout' && !bootError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center px-4">
          <div className="bg-overlay rounded-2xl px-6 py-8 max-w-md w-full text-center">
            <div className="text-5xl mb-3">⏱</div>
            <div className="text-warning text-white mb-3 font-semibold">
              Calibration timed out
            </div>
            <p className="text-base text-muted-foreground mb-6">
              Please position yourself so the camera can see your full body,
              then tap retry.
            </p>
            <button
              onClick={handleCalibrationRetry}
              className="w-full py-4 rounded-xl bg-accent-teal text-slate-900 font-bold text-warning active:scale-95 transition"
            >
              Retry calibration
            </button>
            <Link
              href={`/${exercise.id}`}
              className="block mt-4 text-sm text-muted-foreground hover:text-accent-teal"
            >
              ← Back to exercise
            </Link>
          </div>
        </div>
      )}

      {!calConfirmed && !bootError && calibration?.state !== 'timeout' && (
        <div className="absolute inset-0 z-40 flex flex-col justify-between pointer-events-none px-4 py-6">
          {/* 2026-05-25 Issue 2: prominent top banner with the single most
              actionable failing gate. Hidden when no blocker (all gates pass). */}
          {calibration?.mostBlockingGate && (
            <div className="bg-overlay-amber rounded-2xl px-5 py-4 mx-auto max-w-md text-center">
              <div className="text-warning text-white font-bold leading-snug">
                {CALIB_GATE_HINT_LABEL[calibration.mostBlockingGate] ?? 'Adjust your position'}
              </div>
            </div>
          )}

          <div className="flex items-end sm:items-center justify-center mb-24 sm:mb-0">
            <div className="bg-overlay rounded-2xl px-6 py-6 max-w-md w-full text-center">
              <div className="text-accent-teal text-sm uppercase tracking-widest mb-3 font-semibold">
                Calibrating…
              </div>
              <div className="text-warning text-white mb-5 leading-snug">
                {exercise?.engineModule === 'pushup' ? (
                  <>Get into top of push-up<br />Side-on to camera</>
                ) : exercise?.engineModule === 'lunge' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, arms at sides</>
                ) : exercise?.engineModule === 'bicep-curl' ? (
                  <>Stand tall facing the camera<br />Arms relaxed at your sides</>
                ) : exercise?.engineModule === 'tandem-stand' ? (
                  <>Stand facing the camera<br />One foot in front, hands on hips</>
                ) : exercise?.engineModule === 'single-leg-stand' ? (
                  <>Stand facing the camera<br />Lift one foot off the floor</>
                ) : exercise?.engineModule === 'star-pose' ? (
                  <>Stand on one leg, facing the camera<br />Extend the other leg out to the side, both arms up</>
                ) : exercise?.engineModule === 'standing-figure-4' ? (
                  <>Stand on one leg, facing the camera<br />Cross the other ankle over your knee, hands at chest</>
                ) : exercise?.engineModule === 'gate-pose' ? (
                  <>Kneel facing the camera, one leg out to the side<br />Top arm up, lean slightly to start — then deepen the bend</>
                ) : exercise?.engineModule === 'tree-pose' ? (
                  <>Stand facing the camera<br />Foot on inner calf/thigh, hands at chest</>
                ) : exercise?.engineModule === 'chair-pose' ? (
                  <>Side-on to camera<br />Sink into chair pose, knees bent</>
                ) : exercise?.engineModule === 'warrior-2' ? (
                  <>Face the camera<br />Wide stance, one knee bent</>
                ) : exercise?.engineModule === 'warrior-1' ? (
                  <>Side-on to camera<br />Lunge stance, both arms overhead</>
                ) : exercise?.engineModule === 'warrior-3' ? (
                  <>Side-on to camera<br />Hinge into the airplane T, one leg back</>
                ) : exercise?.engineModule === 'goddess-pose' ? (
                  <>Face the camera<br />Feet wide, knees bent, arms in cactus</>
                ) : exercise?.engineModule === 'triangle-pose' ? (
                  <>Face the camera<br />Wide stance, top arm up, bottom hand to front foot</>
                ) : exercise?.engineModule === 'mountain-pose' ? (
                  <>Stand tall facing the camera<br />Feet together, arms reaching overhead</>
                ) : exercise?.engineModule === 'wall-sit' ? (
                  <>Side-on to camera<br />Back on the wall, knees bent ~90°</>
                ) : exercise?.engineModule === 'lateral-raise' ? (
                  <>Stand facing the camera<br />Arms relaxed at your sides</>
                ) : exercise?.engineModule === 'calf-raise' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, arms at sides</>
                ) : exercise?.engineModule === 'jumping-jacks' ? (
                  <>Stand facing the camera<br />Feet together, arms at sides</>
                ) : exercise?.engineModule === 'high-knees' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, arms relaxed</>
                ) : exercise?.engineModule === 'seated-march' ? (
                  <>Sit tall on a chair, facing the camera<br />Both feet flat, then march your knees</>
                ) : exercise?.engineModule === 'side-leg-raise' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, both feet down</>
                ) : exercise?.engineModule === 'standing-leg-swing' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, both feet down</>
                ) : exercise?.engineModule === 'cat-cow' ? (
                  <>Side-on to the camera, on hands & knees<br />Back flat and level, head neutral to start</>
                ) : exercise?.engineModule === 'oblique-side-bend' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, stand up straight</>
                ) : exercise?.engineModule === 'reverse-lunge' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, arms at sides</>
                ) : exercise?.engineModule === 'lateral-lunge' ? (
                  <>Stand tall facing the camera<br />Feet hip-width, arms at sides</>
                ) : exercise?.engineModule === 'cossack-squat' ? (
                  <>Stand facing the camera in a WIDE stance<br />Feet past shoulder-width, arms relaxed</>
                ) : exercise?.engineModule === 'sit-to-stand' ? (
                  <>Side-on to camera, sit on a chair<br />Feet flat, knees bent ~90°</>
                ) : exercise?.engineModule === 'front-raise' ? (
                  <>Stand facing the camera<br />Arms relaxed at your sides</>
                ) : exercise?.engineModule === 'arm-circles' ? (
                  <>Stand facing the camera<br />Arms relaxed at your sides</>
                ) : exercise?.engineModule === 'side-plank' ? (
                  <>Chest facing the camera<br />Side plank — body in one straight line</>
                ) : exercise?.engineModule === 'boat-pose' ? (
                  <>Side-on to camera, seated<br />Lift legs + chest into a V</>
                ) : exercise?.engineModule === 'standing-forward-fold' ? (
                  <>Side-on to camera<br />Fold forward, hinge at the hips</>
                ) : exercise?.engineModule === 'downward-dog' ? (
                  <>Side-on to camera<br />Lift hips high into an inverted V</>
                ) : exercise?.engineModule === 'cobra-pose' ? (
                  <>Lie face down, side-on to camera<br />Hands under shoulders, lift your chest</>
                ) : exercise?.engineModule === 'seated-forward-fold' ? (
                  <>Sit on the floor, side-on to camera<br />Legs straight out, fold forward over them</>
                ) : isHoldBased ? (
                  <>Side-on to camera, get into<br />plank position</>
                ) : (
                  <>Stand facing the camera<br />feet wide, arms overhead</>
                )}
              </div>
              <ul className="text-base sm:text-lg space-y-2 text-left mb-4">
                <CheckRow
                  ok={!!calibration?.checks.fullBodyVisible}
                  label={
                    exercise?.engineModule === 'pushup'
                      ? 'Side profile in frame'
                      : exercise?.engineModule === 'bicep-curl'
                        ? 'Upper body in frame'
                        : exercise?.engineModule === 'tandem-stand'
                          ? 'Full body in frame'
                          : exercise?.engineModule === 'single-leg-stand'
                            ? 'Full body in frame'
                            : exercise?.engineModule === 'star-pose'
                            ? 'Full body in frame'
                            : exercise?.engineModule === 'standing-figure-4'
                            ? 'Full body in frame'
                            : exercise?.engineModule === 'gate-pose'
                            ? 'Full body in frame'
                            : exercise?.engineModule === 'tree-pose'
                              ? 'Full body in frame'
                              : exercise?.engineModule === 'chair-pose'
                                ? 'Side profile in frame'
                                : exercise?.engineModule === 'warrior-2'
                                  ? 'Full body in frame'
                                  : exercise?.engineModule === 'warrior-1'
                                  ? 'Full body in frame, side-on'
                                  : exercise?.engineModule === 'warrior-3'
                                  ? 'Full body in frame, side-on'
                                  : exercise?.engineModule === 'goddess-pose'
                                    ? 'Full body in frame, facing the camera'
                                  : exercise?.engineModule === 'triangle-pose'
                                    ? 'Full body in frame, facing the camera'
                                  : exercise?.engineModule === 'mountain-pose'
                                    ? 'Full body in frame'
                                    : exercise?.engineModule === 'wall-sit'
                                      ? 'Side profile in frame'
                                    : exercise?.engineModule === 'lateral-raise'
                                      ? 'Full body in frame'
                                      : exercise?.engineModule === 'calf-raise'
                                        ? 'Full body in frame, feet visible'
                                      : exercise?.engineModule === 'jumping-jacks'
                                        ? 'Full body in frame, arms + feet visible'
                                      : exercise?.engineModule === 'high-knees'
                                        ? 'Full body in frame, knees visible'
                                      : exercise?.engineModule === 'seated-march'
                                        ? 'Upper body + both knees in frame'
                                      : exercise?.engineModule === 'side-leg-raise'
                                        ? 'Full body in frame, legs visible'
                                      : exercise?.engineModule === 'standing-leg-swing'
                                        ? 'Full body in frame, legs visible'
                                      : exercise?.engineModule === 'cat-cow'
                                        ? 'Side profile in frame (head to knees)'
                                      : exercise?.engineModule === 'oblique-side-bend'
                                        ? 'Full body in frame, torso visible'
                                      : exercise?.engineModule === 'reverse-lunge'
                                        ? 'Full body in frame, legs visible'
                                      : exercise?.engineModule === 'lateral-lunge'
                                        ? 'Full body in frame, legs visible'
                                      : exercise?.engineModule === 'cossack-squat'
                                        ? 'Full body in frame, legs visible'
                                      : exercise?.engineModule === 'sit-to-stand'
                                        ? 'Side profile in frame'
                                      : exercise?.engineModule === 'front-raise'
                                        ? 'Full body in frame'
                                      : exercise?.engineModule === 'arm-circles'
                                        ? 'Full body in frame'
                                      : exercise?.engineModule === 'side-plank'
                                        ? 'Full body in frame, side-on, chest to camera'
                                      : exercise?.engineModule === 'boat-pose'
                                        ? 'Full body in frame, seated side-on'
                                      : exercise?.engineModule === 'standing-forward-fold'
                                        ? 'Full body in frame, side-on'
                                      : exercise?.engineModule === 'downward-dog'
                                        ? 'Full body in frame, side-on (hands to feet)'
                                      : exercise?.engineModule === 'cobra-pose'
                                        ? 'Full body in frame, side-on (lying down)'
                                      : exercise?.engineModule === 'seated-forward-fold'
                                        ? 'Full body in frame, side-on (seated)'
                                      : isHoldBased
                                        ? 'Side profile in frame'
                                        : 'Full body in frame'
                  }
                />
                <CheckRow
                  ok={!!calibration?.checks.feetWide}
                  label={
                    exercise?.engineModule === 'pushup'
                      ? 'Body horizontal — head to heels'
                      : exercise?.engineModule === 'lunge'
                        ? 'Feet hip-width or narrower'
                        : exercise?.engineModule === 'bicep-curl'
                          ? 'Feet about hip-width, stable'
                          : exercise?.engineModule === 'tandem-stand'
                            ? 'One foot directly in front of the other'
                            : exercise?.engineModule === 'single-leg-stand'
                              ? 'One foot lifted off the floor'
                              : exercise?.engineModule === 'star-pose'
                              ? 'One leg extended out to the side'
                              : exercise?.engineModule === 'standing-figure-4'
                              ? 'Ankle crossed over the standing knee'
                              : exercise?.engineModule === 'gate-pose'
                              ? 'One leg extended out to the side'
                              : exercise?.engineModule === 'tree-pose'
                                ? 'Foot pressed onto your standing leg'
                                : exercise?.engineModule === 'chair-pose'
                                  ? 'Knees bent ~90°, weight in heels'
                                  : exercise?.engineModule === 'warrior-2'
                                    ? 'Wide stance, step one foot out to the side'
                                    : exercise?.engineModule === 'warrior-1'
                                    ? 'Lunge stance — front knee bent, back leg straight'
                                    : exercise?.engineModule === 'warrior-3'
                                    ? 'One leg lifted straight back, toward level'
                                    : exercise?.engineModule === 'goddess-pose'
                                      ? 'Feet wide apart (about 2× shoulder-width), both knees bent'
                                    : exercise?.engineModule === 'triangle-pose'
                                      ? 'Wide stance (~ leg-length apart), both legs locked straight'
                                    : exercise?.engineModule === 'mountain-pose'
                                      ? 'Feet together or hip-width apart'
                                      : exercise?.engineModule === 'wall-sit'
                                        ? 'Knees bent ~90°, thighs parallel'
                                      : exercise?.engineModule === 'lateral-raise'
                                        ? 'Feet about hip-width, stable'
                                        : exercise?.engineModule === 'calf-raise'
                                          ? 'Feet about hip-width apart'
                                        : exercise?.engineModule === 'jumping-jacks'
                                          ? 'Feet together / hip-width'
                                        : exercise?.engineModule === 'high-knees'
                                          ? 'Feet about hip-width apart'
                                        : exercise?.engineModule === 'seated-march'
                                          ? 'Seated — thighs level, knees about hip height'
                                        : exercise?.engineModule === 'side-leg-raise'
                                          ? 'Feet about hip-width apart'
                                        : exercise?.engineModule === 'standing-leg-swing'
                                          ? 'Feet about hip-width apart'
                                        : exercise?.engineModule === 'cat-cow'
                                          ? 'On all fours, back flat and level'
                                        : exercise?.engineModule === 'oblique-side-bend'
                                          ? 'Feet about hip-width apart'
                                        : exercise?.engineModule === 'reverse-lunge'
                                          ? 'Feet hip-width or narrower'
                                        : exercise?.engineModule === 'lateral-lunge'
                                          ? 'Feet hip-width (you step wide during the lunge)'
                                        : exercise?.engineModule === 'cossack-squat'
                                          ? 'Wide stance — feet past shoulder-width'
                                        : exercise?.engineModule === 'sit-to-stand'
                                          ? 'Seated, knees bent ~90°'
                                        : exercise?.engineModule === 'front-raise'
                                          ? 'Feet about hip-width, stable'
                                        : exercise?.engineModule === 'arm-circles'
                                          ? 'Feet about hip-width, stable'
                                        : exercise?.engineModule === 'side-plank'
                                          ? 'Body in one long line (head to feet)'
                                        : exercise?.engineModule === 'boat-pose'
                                          ? 'Legs lifted off the floor into the V'
                                        : exercise?.engineModule === 'standing-forward-fold'
                                          ? 'Hinge forward at the hips'
                                        : exercise?.engineModule === 'downward-dog'
                                          ? 'Hips lifted high into an inverted V'
                                        : exercise?.engineModule === 'cobra-pose'
                                          ? 'Lying prone — legs flat on the floor'
                                        : exercise?.engineModule === 'seated-forward-fold'
                                          ? 'Legs straight out along the floor'
                                        : isHoldBased
                                          ? 'Body horizontal (head to heels)'
                                          : 'Feet wider than shoulders'
                  }
                />
                <CheckRow
                  ok={!!calibration?.checks.armsOverhead}
                  label={
                    exercise?.engineModule === 'pushup'
                      ? 'Arms fully straight — at the TOP of the push-up'
                      : exercise?.engineModule === 'lunge'
                        ? 'Arms relaxed at your sides'
                        : exercise?.engineModule === 'bicep-curl'
                          ? 'Both arms straight down at sides'
                          : exercise?.engineModule === 'tandem-stand'
                            ? 'Hands resting on your hips'
                            : exercise?.engineModule === 'single-leg-stand'
                              ? 'Arms relaxed at your sides'
                              : exercise?.engineModule === 'star-pose'
                              ? 'Both arms raised up into the star'
                              : exercise?.engineModule === 'standing-figure-4'
                              ? 'Hands together at your chest'
                              : exercise?.engineModule === 'gate-pose'
                              ? 'Top arm raised, lean slightly to the side'
                              : exercise?.engineModule === 'tree-pose'
                                ? 'Hands at chest or extended overhead'
                                : exercise?.engineModule === 'chair-pose'
                                  ? 'Arms extended forward or overhead'
                                  : exercise?.engineModule === 'warrior-2'
                                    ? 'One knee bent ~90°, other leg straight'
                                    : exercise?.engineModule === 'warrior-1'
                                    ? 'Both arms reaching straight overhead'
                                    : exercise?.engineModule === 'warrior-3'
                                    ? 'Torso hinged level, standing leg straight'
                                    : exercise?.engineModule === 'goddess-pose'
                                      ? 'Arms in cactus — elbows at shoulder height, palms forward'
                                    : exercise?.engineModule === 'triangle-pose'
                                      ? 'Top arm straight up to the sky, bottom hand down to the front foot'
                                    : exercise?.engineModule === 'mountain-pose'
                                      ? 'Arms reaching overhead toward the ceiling'
                                      : exercise?.engineModule === 'wall-sit'
                                        ? 'Back flat & upright against the wall'
                                      : exercise?.engineModule === 'lateral-raise'
                                        ? 'Both arms relaxed at your sides'
                                        : exercise?.engineModule === 'calf-raise'
                                          ? 'Arms relaxed at your sides'
                                        : exercise?.engineModule === 'jumping-jacks'
                                          ? 'Arms relaxed at your sides'
                                        : exercise?.engineModule === 'high-knees'
                                          ? 'Arms relaxed at your sides'
                                        : exercise?.engineModule === 'seated-march'
                                          ? 'Both feet flat on the floor to start'
                                        : exercise?.engineModule === 'side-leg-raise'
                                          ? 'Both feet on the floor (start standing)'
                                        : exercise?.engineModule === 'standing-leg-swing'
                                          ? 'Both feet on the floor (start standing)'
                                        : exercise?.engineModule === 'cat-cow'
                                          ? 'Spine and head neutral to start'
                                        : exercise?.engineModule === 'oblique-side-bend'
                                          ? 'Stand up straight (not yet bent)'
                                        : exercise?.engineModule === 'reverse-lunge'
                                          ? 'Arms relaxed at your sides'
                                        : exercise?.engineModule === 'lateral-lunge'
                                          ? 'Arms relaxed at your sides'
                                        : exercise?.engineModule === 'cossack-squat'
                                          ? 'Arms relaxed at your sides'
                                        : exercise?.engineModule === 'sit-to-stand'
                                          ? 'Sit upright (chest tall)'
                                        : exercise?.engineModule === 'front-raise'
                                          ? 'Both arms straight down at sides'
                                        : exercise?.engineModule === 'arm-circles'
                                          ? 'Both arms straight down at sides'
                                        : exercise?.engineModule === 'side-plank'
                                          ? 'Hips lifted — straight, no sag'
                                        : exercise?.engineModule === 'boat-pose'
                                          ? 'Chest lifted, leaning back into the V'
                                        : exercise?.engineModule === 'standing-forward-fold'
                                          ? 'Legs straight (soft knees, not bent)'
                                        : exercise?.engineModule === 'downward-dog'
                                          ? 'Arms & legs long, hands and feet planted'
                                        : exercise?.engineModule === 'cobra-pose'
                                          ? 'Chest lifted off the floor'
                                        : exercise?.engineModule === 'seated-forward-fold'
                                          ? 'Fold forward over your legs'
                                        : isHoldBased
                                          ? 'Forearms / hands under shoulders'
                                          : 'Both arms overhead'
                  }
                />
                <CheckRow
                  ok={!!calibration?.checks.distanceOk}
                  label={
                    calibration?.distanceHint === 'too-close'
                      ? 'Step back — too close to camera'
                      : calibration?.distanceHint === 'too-far'
                        ? 'Step closer — too far from camera'
                        : 'Good distance from camera'
                  }
                />
              </ul>
              {calibration && (
                <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-teal transition-all"
                    style={{ width: `${(calibration.progressMs / 2000) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rep-based HUD */}
      {calConfirmed && status === 'tracking' && !isHoldBased && currentSet && (
        <HUD
          currentSet={currentSetIndex + 1}
          totalSets={setup.plannedSets ?? 0}
          repsThisSet={repsThisSet}
          plannedReps={currentSet.plannedReps}
          mqs={mqs}
          depthDeg={latestFrame?.smoothedFlexionDeg ?? 0}
        />
      )}

      {/* Hold-based timer */}
      {calConfirmed && status === 'tracking' && isHoldBased && holdRecord && (
        <HoldTimer
          secondsElapsed={holdRecord.actualDurationSec}
          targetDurationSec={holdRecord.targetDurationSec}
          formScore={holdRecord.averageMqs}
        />
      )}

      {status === 'resting' && restEndsAt && currentSet && (
        <RestCountdown restEndsAt={restEndsAt} setRecord={currentSet} onSkip={skipRest} />
      )}

      {/* Rule A — exactly one warning chip on screen, lifted above depth bar */}
      {currentWarning && status !== 'resting' && !ending && (
        <div className="absolute bottom-44 sm:bottom-32 left-1/2 -translate-x-1/2 z-20 px-4">
          <PostureWarningChip type={currentWarning.type} severity={currentWarning.severity} />
        </div>
      )}

      {/* Graceful hold-end overlay — shown while the "Hold ended / complete" cue
          plays, just before navigating to the report (see finishHold). */}
      {ending && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-overlay rounded-2xl px-8 py-7 max-w-md w-full mx-4 text-center">
            <div className="text-hud-md text-white font-semibold">Hold ended</div>
            <div className="text-warning text-accent-teal mt-2">Showing your results…</div>
          </div>
        </div>
      )}

      <Link
        href={`/${exercise.id}`}
        className="absolute top-3 right-3 sm:top-6 sm:right-1/2 sm:translate-x-1/2 text-sm text-white bg-overlay px-4 py-2 rounded-lg z-20 font-semibold"
      >
        ← Quit
      </Link>

      {/* Audio + voice toggles — bottom-left to avoid depth-bar overlap, hidden during rest */}
      {status !== 'resting' && (
        <div className="absolute bottom-4 left-3 z-20">
          <AudioToggle />
        </div>
      )}

      {/* 2026-05-25 Issue 4: manual "Complete" button — only visible during the
          active tracking phase (after calibration confirms, before workout is
          complete). One-tap end → speak confirmation → store.manualEndWorkout()
          → useEffect routes to /report. */}
      {calConfirmed && status === 'tracking' && (
        <button
          onClick={handleManualComplete}
          className="absolute bottom-4 right-3 z-20 px-5 py-3 rounded-xl bg-overlay-danger text-white font-bold text-base active:scale-95 transition shadow-lg"
          aria-label="End session manually"
        >
          ⏹ Complete
        </button>
      )}
    </main>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-lg font-bold ${
          ok ? 'bg-accent-teal text-slate-900' : 'bg-surface-3 text-muted-foreground'
        }`}
      >
        {ok ? '✓' : '·'}
      </span>
      <span className={`flex-1 ${ok ? 'text-white' : 'text-muted-foreground'}`}>{label}</span>
    </li>
  );
}
