import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, countWarnings } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

// MAX_ARCH_FRAC = 1.30 — hipRiseFraction > 1.30 → lower-back-arch (during active rep)

const CAL_MS = 400;
const REP_CYCLE_MS = 2300;

function makeFrames(
  repCycle: (tInRep: number) => Partial<GluteBridgePoseIntent>,
  reps = 3,
) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
      const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
      return { hipRise: 0, ...repCycle(tInRep) } as GluteBridgePoseIntent;
    },
    buildGluteBridgePose,
    { fps: 30, durationMs: CAL_MS + reps * REP_CYCLE_MS + 500 },
  );
}

describe('Glute Bridge — posture warnings', () => {
  it('fires lower-back-arch when hipRise exceeds 1.30 during an active rep', () => {
    // Rise to 1.40 at peak — past MAX_ARCH_FRAC=1.30.
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 900) hipRise = (t / 900) * 1.40;
      else if (t < 1200) hipRise = 1.40;
      else if (t < 2000) hipRise = 1.40 - ((t - 1200) / 800) * 1.40;
      else hipRise = 0;
      return { hipRise };
    });
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBeGreaterThan(0);
  });

  it('does NOT fire lower-back-arch on clean reps peaking at 1.0', () => {
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 900) hipRise = t / 900;
      else if (t < 1200) hipRise = 1.0;
      else if (t < 2000) hipRise = 1.0 - ((t - 1200) / 800);
      else hipRise = 0;
      return { hipRise };
    });
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBe(0);
    expect(countWarnings(result, 'incomplete-bridge')).toBe(0);
  });

  it('does NOT fire any unexpected warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => {
      let hipRise: number;
      if (t < 900) hipRise = t / 900;
      else if (t < 1200) hipRise = 1.0;
      else if (t < 2000) hipRise = 1.0 - ((t - 1200) / 800);
      else hipRise = 0;
      return { hipRise };
    });
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBe(0);
    expect(countWarnings(result, 'incomplete-bridge')).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
