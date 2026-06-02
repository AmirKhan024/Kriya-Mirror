/**
 * Fix C + O regression: after a rep completes the engine reseeds the EMA
 * baseline and resets the idle timer. The user should get a fresh 5s grace
 * window before 'not-moving' fires again.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, countWarnings } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_CYCLE_MS = 3000;

function repFlex(t: number, peak = 130): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Hammer Curl — not-moving does not fire immediately after a rep', () => {
  it('does not fire not-moving within 3s of completing the first rep', () => {
    // 1 rep, then 3 s of rest (arms at sides, flex = 0)
    const totalMs = CAL_MS + REP_CYCLE_MS + 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal < REP_CYCLE_MS) {
          return { elbowFlexionDeg: repFlex(tAfterCal) } as HammerCurlPoseIntent;
        }
        return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runHammerCurlSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
