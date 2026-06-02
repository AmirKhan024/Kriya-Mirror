import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, countWarnings } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

// MIN_REP_RISE_FRAC = 0.40 — reps with peak < 0.40 are rejected → incomplete-bridge
// MAX_HIP_VELOCITY = 1.5 /s — reps that rise too fast → malformed-rep
// MIN_REP_DURATION_MS = 400ms

const CAL_MS = 400;

function makeFrames(
  repCycle: (tInRep: number) => Partial<GluteBridgePoseIntent>,
  reps = 4,
  repCycleMs = 2300,
) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { hipRise: 0, ...repCycle(tInRep) } as GluteBridgePoseIntent;
    },
    buildGluteBridgePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Glute Bridge — rep validation gates', () => {
  it('rejects shallow reps (peak hipRise = 0.3, below MIN_REP_RISE_FRAC=0.40)', () => {
    // Rise only to 0.3 — below the 0.40 threshold.
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 900) hipRise = (t / 900) * 0.3;
      else if (t < 1200) hipRise = 0.3;
      else if (t < 2000) hipRise = 0.3 - ((t - 1200) / 800) * 0.3;
      else hipRise = 0;
      return { hipRise };
    });
    const result = runGluteBridgeSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-bridge')).toBeGreaterThan(0);
  });

  it('accepts reps just above the threshold (peak = 0.50, clear of EMA lag)', () => {
    // EMA smoothing (α=0.15) means the smoothed value lags the raw input.
    // Testing at 0.50 gives clear margin above MIN_REP_RISE_FRAC=0.40 post-EMA.
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 900) hipRise = (t / 900) * 0.50;
      else if (t < 1200) hipRise = 0.50;
      else if (t < 2000) hipRise = 0.50 - ((t - 1200) / 800) * 0.50;
      else hipRise = 0;
      return { hipRise };
    }, 3);
    const result = runGluteBridgeSession(frames);
    expect(result.completedReps.length).toBeGreaterThan(0);
  });

  it('rejects ballistic reps (rise 0→1 in ~100ms — velocity far exceeds 1.5/s)', () => {
    // hipRise goes from 0 to 1 in 100ms → velocity ≈ 10/s >> MAX_HIP_VELOCITY 1.5
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 100) hipRise = t / 100;
      else if (t < 600) hipRise = 1.0;
      else if (t < 1400) hipRise = 1.0 - ((t - 600) / 800);
      else hipRise = 0;
      return { hipRise };
    }, 4, 2000);
    const result = runGluteBridgeSession(frames);
    // Ballistic reps should either be rejected as malformed or incomplete
    const malformedOrIncomplete =
      countWarnings(result, 'malformed-rep') + countWarnings(result, 'incomplete-bridge');
    expect(result.completedReps.length).toBe(0);
    expect(malformedOrIncomplete).toBeGreaterThan(0);
  });

  it('counts valid full-extension reps correctly', () => {
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 900) hipRise = t / 900;
      else if (t < 1200) hipRise = 1.0;
      else if (t < 2000) hipRise = 1.0 - ((t - 1200) / 800);
      else hipRise = 0;
      return { hipRise };
    }, 4);
    const result = runGluteBridgeSession(frames);
    expect(result.completedReps.length).toBe(4);
    expect(countWarnings(result, 'incomplete-bridge')).toBe(0);
  });
});
