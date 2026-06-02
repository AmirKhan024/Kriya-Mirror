/**
 * Clamshell — rep validation.
 *
 * Tests:
 *   - Shallow rep (abductionFrac only reaches 0.10 — below MIN_REP_OPEN_FRAC 0.22):
 *       → expect 'incomplete-clamshell' warning + rep NOT recorded
 *   - Ballistic rep (abductionFrac velocity > 1.5/sec):
 *       → expect 'malformed-rep' + rep NOT recorded
 *   - Too-short rep (< 400ms):
 *       → expect 'malformed-rep'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildClamshellPose } from '../../harness/pose-stub';
import { runClamshellSession, countWarnings } from '../../harness/runner';
import type { ClamshellPoseIntent } from '../../harness/types';

const CAL_MS = 400;

describe('Clamshell — rep validation', () => {
  it('emits incomplete-clamshell and rejects reps when peak is below 0.22', () => {
    // Shallow reps: only opens to 0.10 (below MIN_REP_OPEN_FRAC=0.22).
    // Use 4 reps so the warning fires after the 2500ms cooldown passes.
    const repCycleMs = 2300;
    const reps = 4;
    const totalMs = CAL_MS + reps * repCycleMs + 500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let frac: number;
        if (tInRep < 900) frac = (tInRep / 900) * 0.10;  // only open to 0.10
        else if (tInRep < 1200) frac = 0.10;
        else if (tInRep < 2000) frac = 0.10 - ((tInRep - 1200) / 800) * 0.10;
        else frac = 0;
        return { abductionFrac: frac, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runClamshellSession(frames);
    // All reps should be rejected (shallow)
    expect(result.completedReps.length).toBe(0);
    // Warning should fire at least once (fires on 2nd+ attempt after cooldown)
    expect(countWarnings(result, 'incomplete-clamshell')).toBeGreaterThan(0);
  });

  it('rejects malformed (ballistic) reps and emits malformed-rep warning', () => {
    // Ballistic rep: 0 → 0.60 in 100ms → normalized velocity ≈ 6/s >> MAX_KNEE_VELOCITY=1.5.
    // We do the rep LATE (3000ms post-cal) so the cooldown (2500ms) is already cleared.
    const preIdleMs = 3000;  // idle before first rep (ensures now > WARNING_REPEAT_COOLDOWN_MS)
    const repMs = 1500;
    const totalMs = CAL_MS + preIdleMs + repMs;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        const tPost = tMs - CAL_MS;
        if (tPost < preIdleMs) {
          // Idle before the rep
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        const tInRep = tPost - preIdleMs;
        // Fast open: 0 → 0.60 in 100ms → raw velocity 6/s
        let frac: number;
        if (tInRep < 100) frac = (tInRep / 100) * 0.60;
        else if (tInRep < 600) frac = 0.60;                    // hold at top
        else if (tInRep < 700) frac = 0.60 - ((tInRep - 600) / 100) * 0.60;
        else frac = 0;
        return { abductionFrac: frac, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runClamshellSession(frames);
    // Rep should be rejected due to high velocity or too-short duration
    // Warning should fire (we're past the 2500ms cooldown)
    const allBadWarnings =
      countWarnings(result, 'malformed-rep') + countWarnings(result, 'incomplete-clamshell');
    expect(result.completedReps.length).toBe(0);
    expect(allBadWarnings).toBeGreaterThan(0);
  });

  it('accepts a valid rep with peak >= 0.22 and duration >= 400ms', () => {
    // Good rep: opens to 0.35 over 800ms
    const totalMs = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let frac: number;
        if (tInRep < 800) frac = (tInRep / 800) * 0.35;
        else if (tInRep < 1100) frac = 0.35;
        else if (tInRep < 1900) frac = 0.35 - ((tInRep - 1100) / 800) * 0.35;
        else frac = 0;
        return { abductionFrac: frac, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runClamshellSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'incomplete-clamshell')).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
