import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSingleLegStandPose } from '../../harness/pose-stub';
import { runSingleLegStandSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Single Leg Stand — sway detection', () => {
  it('fires swaying warning when CoM drifts past clinical threshold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        // Sustained sway of 0.045 — round-15 raised threshold to 12°. At
        // shoulderWidth=0.16, 0.045/0.16 = 0.281 → atan ≈ 15.7°, past 12°.
        const swayX = tAfter >= 2000 && tAfter < 3500 ? 0.045 : 0;
        return { liftedSide: 'left' as const, swayX };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
  });

  it('does NOT fire swaying for momentary jitter (4 frames)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        // Round 15: bumped above the new 12° threshold so the test exercises
        // the entry-debounce (not the threshold). 0.060 → ~20° instantaneously.
        const swayX = tAfter >= 2000 && tAfter < 2120 ? 0.060 : 0;
        return { liftedSide: 'left' as const, swayX };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('does NOT fire on a clean still hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('round 12: alternating in/out jitter at the threshold does NOT fire', () => {
    // Per-frame sway oscillates between above and below threshold every
    // single frame for 4 seconds. Without round-12 hysteresis the warn would
    // chatter on/off; with hysteresis, neither entry nor exit debounce
    // accumulates 6 consecutive frames → warn never fires.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        if (tAfter < 2000 || tAfter >= 6000) {
          return { liftedSide: 'left' as const };
        }
        // Per-frame parity at 30 fps (33.33ms intervals).
        const frameIdx = Math.floor(tMs / (1000 / 30));
        return {
          liftedSide: 'left' as const,
          // Round 15: bumped to 0.045 so the "above" pulses clear the new 12° threshold.
          swayX: frameIdx % 2 === 0 ? 0.045 : 0,
        };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });
});
