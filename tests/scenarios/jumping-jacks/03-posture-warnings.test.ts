import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession, countWarnings } from '../../harness/runner';
import type { JumpingJacksPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<JumpingJacksPoseIntent>, reps = 3, repCycleMs = 2000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { armOpennessPct: 0, legOpennessPct: 30, ...repCycle(tInRep) } as JumpingJacksPoseIntent;
    },
    buildJumpingJacksPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repCycle(t: number): { armOpennessPct: number; legOpennessPct: number } {
  let arm: number, leg: number;
  if (t < 500) { arm = (t / 500) * 100; leg = 30 + (t / 500) * 70; }
  else if (t < 1000) { arm = 100; leg = 100; }
  else if (t < 1500) { arm = 100 - ((t - 1000) / 500) * 100; leg = 100 - ((t - 1000) / 500) * 70; }
  else { arm = 0; leg = 30; }
  return { armOpennessPct: arm, legOpennessPct: leg };
}

describe('Jumping Jacks — posture warnings', () => {
  it('fires torso-swing warning when shoulder mid x oscillates past threshold', () => {
    const frames = makeFrames((t) => {
      const { armOpennessPct, legOpennessPct } = repCycle(t);
      // Sustained sway 0.06 during active phases (above 0.04 threshold).
      const torsoSwayX = armOpennessPct > 20 ? 0.06 : 0;
      return { armOpennessPct, legOpennessPct, torsoSwayX };
    }, 3);
    const result = runJumpingJacksSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => repCycle(t), 3);
    const result = runJumpingJacksSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'incomplete-jack')).toBe(0);
  });

  it('momentary torso sway (4 frames) does NOT trigger a warning', () => {
    const frames = makeFrames((t) => {
      const cycle = repCycle(t);
      // 4-frame spike (~133 ms at 30 fps) — below TORSO_SWING_DEBOUNCE_FRAMES=8.
      const torsoSwayX = t >= 800 && t <= 920 ? 0.06 : 0;
      return { ...cycle, torsoSwayX };
    }, 2);
    const result = runJumpingJacksSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
