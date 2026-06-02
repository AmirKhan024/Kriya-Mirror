/**
 * Regression test for position-lost warning on Clamshell.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for >= 3 seconds post-calibration, the engine emits
 * 'position-lost'. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildClamshellPose } from '../../harness/pose-stub';
import { runClamshellSession, countWarnings } from '../../harness/runner';
import type { ClamshellPoseIntent } from '../../harness/types';

const CAL_MS = 400;

describe('Clamshell — position-lost warning', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        // User rolls out of frame.
        return null;
      },
      buildClamshellPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent),
      buildClamshellPose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runClamshellSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // Null frames before calibration confirms — position-lost must not fire
    // because the engine isn't tracking yet.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runClamshellSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('fires exactly once within a 5-second null window (10s repeat cooldown)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
        }
        return null;
      },
      buildClamshellPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runClamshellSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
