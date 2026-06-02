/**
 * Regression test for Fix N (position-lost) on Glute Bridge.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for >= 3 seconds post-calibration, the engine emits
 * 'position-lost'. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, countWarnings } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

const CAL_MS = 400;

describe('Glute Bridge — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
        // User rolls out of frame.
        return null;
      },
      buildGluteBridgePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ hipRise: 0 } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // Null frames before calibration confirms — position-lost must not fire
    // because the engine isn't tracking yet.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { hipRise: 0 } as GluteBridgePoseIntent;
      },
      buildGluteBridgePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('fires exactly once within a 5-second null window (10s repeat cooldown)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
        return null;
      },
      buildGluteBridgePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
