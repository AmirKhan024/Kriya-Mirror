import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

// Star Pose reuses the single-leg sway pattern: shoulderWidth 0.16, 16° warn
// threshold. swayX 0.058 → 0.058/0.16 = 0.363 → atan ≈ 19.9° (past 16°).
describe('Star Pose — sway detection', () => {
  it('fires swaying warning when CoM drifts past the clinical threshold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const swayX = tAfter >= 2000 && tAfter < 3500 ? 0.058 : 0;
        return { liftedSide: 'left' as const, swayX };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
  });

  it('does NOT fire swaying for momentary jitter (4 frames)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const swayX = tAfter >= 2000 && tAfter < 2120 ? 0.060 : 0;
        return { liftedSide: 'left' as const, swayX };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('does NOT fire on a clean still hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('does NOT over-freeze a FAR hold (small shoulderWidth) on a moderate wobble', () => {
    // Physical test: a far user calibrates at shoulderWidth ~0.09, which used to
    // over-amplify sway. At the 0.12 runtime floor, swayX 0.03 reads ~14°
    // (atan(0.03/0.12)) — under the 16° gate — so the hold keeps counting.
    const frames = buildFrames(
      (tMs) => {
        const base = { liftedSide: 'left' as const, shoulderWidthOverride: 0.09 };
        if (tMs - CAL_MS < 2500) return base;
        return { ...base, swayX: 0.03 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 7000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'swaying')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(5); // never froze
  });

  it('hysteresis: alternating in/out jitter at the threshold does NOT fire', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        if (tAfter < 2000 || tAfter >= 6000) return { liftedSide: 'left' as const };
        const frameIdx = Math.floor(tMs / (1000 / 30));
        return { liftedSide: 'left' as const, swayX: frameIdx % 2 === 0 ? 0.045 : 0 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });
});
