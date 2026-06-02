/**
 * 2026-05-28 round 22: Calf Raise is now HOLD-based. Round-21 rep-cycle
 * posture warnings (torso-swing / low-heel-rise) no longer apply. The hold
 * engine surfaces only `heel-dropped` + `position-lost` warnings. This test
 * confirms unrelated warning types stay silent on a clean sustained hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';

const CAL_MS = 2200;
const RISE_MS = 1000;

describe('Calf Raise — no spurious warnings on clean hold (round 22)', () => {
  it('does NOT emit heel-dropped, position-lost, or any other warning on a 6 s clean hold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        const t = tMs - CAL_MS;
        if (t < RISE_MS) return { heelRisePct: (t / RISE_MS) * 15 };
        return { heelRisePct: 15 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + RISE_MS + 6000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.warnings.length).toBe(0);
  });

  it('does NOT emit warnings even with mild shoulder-X sway during the hold', () => {
    // Round-21 torso-swing chip was disabled at engine level; round-22 hold
    // engine doesn't emit torso-swing at all (no rep cycle). Verify silence.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        const t = tMs - CAL_MS;
        if (t < RISE_MS) return { heelRisePct: (t / RISE_MS) * 15 };
        return { heelRisePct: 15, torsoSwayX: 0.06 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + RISE_MS + 4000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.warnings.filter((w) => w.type === 'torso-swing').length).toBe(0);
    expect(result.warnings.filter((w) => w.type === 'heel-dropped').length).toBe(0);
  });
});
