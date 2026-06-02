import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Tandem Stand — sway detection', () => {
  it('fires swaying warning when CoM drifts persistently past clinical threshold', () => {
    // Drift the upper body by 0.025 (well past the threshold once normalized
    // by shoulderWidth ≈ 0.16 → sway angle ≈ atan(0.156, 1) ≈ 8.9°, above
    // the 6° warning threshold).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { tandemAhead: 'left' as const };
        // After calibration: drift sustained for 1.5s
        const tAfter = tMs - CAL_MS;
        const swayX = tAfter >= 2000 && tAfter < 3500 ? 0.025 : 0;
        return { tandemAhead: 'left' as const, swayX };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
  });

  it('does NOT fire swaying for momentary jitter (4 frames)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { tandemAhead: 'left' as const };
        const tAfter = tMs - CAL_MS;
        // Brief 4-frame spike (~133ms at 30fps) — below SWAY_WARN_FRAMES=6.
        const swayX = tAfter >= 2000 && tAfter < 2120 ? 0.030 : 0;
        return { tandemAhead: 'left' as const, swayX };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('does NOT fire on a clean still hold (sanity)', () => {
    const frames = buildFrames(
      () => ({ tandemAhead: 'left' as const }),
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('round 12: alternating in/out jitter at the threshold does NOT fire', () => {
    // Per-frame sway oscillates above/below threshold every frame for 4
    // seconds. Without round-12 hysteresis the warn would chatter; with it,
    // neither entry nor exit debounce accumulates 6 consecutive frames.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { tandemAhead: 'left' as const };
        const tAfter = tMs - CAL_MS;
        if (tAfter < 2000 || tAfter >= 6000) {
          return { tandemAhead: 'left' as const };
        }
        // Per-frame parity at 30 fps (33.33ms intervals).
        const frameIdx = Math.floor(tMs / (1000 / 30));
        return {
          tandemAhead: 'left' as const,
          swayX: frameIdx % 2 === 0 ? 0.025 : 0,
        };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });
});
