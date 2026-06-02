/**
 * Mountain Climber — regression: not-moving fires after a real rep + idle (Fix O)
 *
 * Mirror of lunge/14-not-moving-after-rep.test.ts.
 *
 * The bug would be: user does 3 drives, then holds the plank for 8s, but
 * `not-moving` never fires because the EMA still carries a decay tail that
 * inflates the angle variance window beyond the 2° gate.
 *
 * Fix O: once smoothedKneeAngle has settled (per-frame delta < 0.3° for 500ms),
 * drop the cached min/max and reseed from the current value (plankSettledSince /
 * plankBaselineReseeded pattern). This closes the variance accumulator so a
 * genuine 5s idle is detected after a rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, countWarnings } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;
const REP_CYCLE_MS = 1600;  // one full rep cycle (drive + hold + return + rest)

describe('Mountain Climber — not-moving fires after a real rep (Fix O)', () => {
  it('fires not-moving when user rests in PLANK after completing 3 drives', () => {
    // 3 full knee drives, then 8s of PLANK idle.
    const REP_END_MS = CAL_MS + 3 * REP_CYCLE_MS;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, bodyLength: 0.55 };
        if (tMs < REP_END_MS) {
          const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
          let angle: number;
          if (tInRep < 500)       angle = 170 - (tInRep / 500) * 120;  // 170 → 50
          else if (tInRep < 800)  angle = 50;
          else if (tInRep < 1300) angle = 50 + ((tInRep - 800) / 500) * 120;  // 50 → 170
          else                    angle = 170;
          return { kneeHipAngleDeg: angle, bodyLength: 0.55 };
        }
        // Post-rep idle: hold still in PLANK
        return { kneeHipAngleDeg: 165, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // 3 reps completed
    expect(result.completedReps.length).toBe(3);
    // The key assertion: idle warning fires post-rep
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving when the user immediately starts the next drive', () => {
    // Continuous driving without a 5s pause
    const TOTAL_MS = CAL_MS + 5 * REP_CYCLE_MS + 500;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, bodyLength: 0.55 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let angle: number;
        if (tInRep < 500)       angle = 170 - (tInRep / 500) * 120;
        else if (tInRep < 800)  angle = 50;
        else if (tInRep < 1300) angle = 50 + ((tInRep - 800) / 500) * 120;
        else                    angle = 170;
        return { kneeHipAngleDeg: angle, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
