/**
 * Nordic Curl — not-moving after a rep (Fix O: EMA reseed)
 *
 * After completing a rep, the EMA-smoothed lean decays slowly from ~15° → 0°.
 * Without Fix O, this decay tail keeps the variance > 2° and 'not-moving'
 * never fires during the idle period that follows.
 *
 * With Fix O (EMA reseed): once the EMA has settled (< 0.3°/frame change for
 * 500ms), we reseed the min/max baseline from the settled value. Then if the
 * user genuinely stays still for 5s, not-moving fires.
 *
 * Tests:
 * - Do one rep (lean 0→55→0°), then idle 8s in TALL
 * - Assert 'not-moving' fires after 5s of idle post-rep
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildNordicCurlPose } from '../../harness/pose-stub';
import { runNordicCurlSession, countWarnings } from '../../harness/runner';
import type { NordicCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2500;

function calFrames() {
  return buildFrames(
    () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
    buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
    { fps: 30, durationMs: CAL_MS },
  );
}

describe('Nordic Curl — not-moving after rep (Fix O)', () => {
  it('fires not-moving after 8s idle post-rep', () => {
    // One rep: 0° → 55° → 0° in ~3.5s
    const repFrames = buildFrames(
      (t) => {
        const DESCENT_MS = 1500;
        const HOLD_MS = 500;
        const ASCENT_MS = 1500;
        const REP_MS = DESCENT_MS + HOLD_MS + ASCENT_MS;
        if (t < DESCENT_MS) {
          return { trunkLeanDeg: (t / DESCENT_MS) * 55, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        if (t < DESCENT_MS + HOLD_MS) {
          return { trunkLeanDeg: 55, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        if (t < REP_MS) {
          const tAscent = t - DESCENT_MS - HOLD_MS;
          return { trunkLeanDeg: 55 - (tAscent / ASCENT_MS) * 55, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 3500 + 8000 }, // rep + 8s idle
    );

    const frames = concatFrames(calFrames(), repFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should have exactly 1 rep (the one we did)
    expect(result.completedReps.length).toBe(1);
    // After 8s idle, not-moving should have fired
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving immediately after rep completion', () => {
    // One rep + only 3s idle (less than 5s threshold)
    const repPlusShortIdleFrames = buildFrames(
      (t) => {
        const DESCENT_MS = 1500;
        const HOLD_MS = 500;
        const ASCENT_MS = 1500;
        const REP_MS = DESCENT_MS + HOLD_MS + ASCENT_MS;
        if (t < DESCENT_MS) {
          return { trunkLeanDeg: (t / DESCENT_MS) * 55, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        if (t < DESCENT_MS + HOLD_MS) {
          return { trunkLeanDeg: 55, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        if (t < REP_MS) {
          const tAscent = t - DESCENT_MS - HOLD_MS;
          return { trunkLeanDeg: 55 - (tAscent / ASCENT_MS) * 55, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 3500 + 3000 }, // rep + 3s idle only
    );

    const frames = concatFrames(calFrames(), repPlusShortIdleFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    // 3s idle is not enough to trigger not-moving (need 5s)
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
