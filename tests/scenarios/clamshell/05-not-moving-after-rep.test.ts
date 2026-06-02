/**
 * Clamshell — not-moving after rep (Fix O / EMA reseed).
 *
 * Do one rep (open then close), then idle 8s in CLOSED.
 * Assert: 'not-moving' fires after 5s of idle post-rep.
 * Without Fix O, EMA decay tail inflates variance, not-moving never fires.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildClamshellPose } from '../../harness/pose-stub';
import { runClamshellSession, countWarnings } from '../../harness/runner';
import type { ClamshellPoseIntent } from '../../harness/types';

const CAL_MS = 400;
const REP_MS = 2500;   // one rep cycle

describe('Clamshell — not-moving after a rep (EMA reseed / Fix O)', () => {
  it('fires not-moving after 5s idle following a completed rep', () => {
    // One rep, then 8s of stillness
    const idleMs = 8000;
    const totalMs = CAL_MS + REP_MS + idleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        const tPost = tMs - CAL_MS;
        if (tPost < REP_MS) {
          // One good rep: open to 0.45, hold, close
          const tInRep = tPost;
          let frac: number;
          if (tInRep < 900) frac = (tInRep / 900) * 0.45;
          else if (tInRep < 1200) frac = 0.45;
          else if (tInRep < 2000) frac = 0.45 - ((tInRep - 1200) / 800) * 0.45;
          else frac = 0;
          return { abductionFrac: frac, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        // Idle after rep
        return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    // After the rep + 5+ idle seconds → not-moving should fire
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does not fire not-moving if user immediately starts second rep', () => {
    // Two reps back-to-back, no idle gap
    const totalMs = CAL_MS + 2 * REP_MS + 500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        const tPost = tMs - CAL_MS;
        const tInRep = tPost % REP_MS;
        let frac: number;
        if (tInRep < 900) frac = (tInRep / 900) * 0.45;
        else if (tInRep < 1200) frac = 0.45;
        else if (tInRep < 2000) frac = 0.45 - ((tInRep - 1200) / 800) * 0.45;
        else frac = 0;
        return { abductionFrac: frac, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runClamshellSession(frames);
    expect(result.completedReps.length).toBe(2);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
