/**
 * 2026-05-28 round 22: The `not-moving` warning concept doesn't apply to the
 * heel-rise hold model — being stationary IS the goal. The engine no longer
 * fires `not-moving`. This file preserves the test name for git-blame
 * continuity but flips the assertion: the engine must NEVER emit `not-moving`
 * regardless of how long the user stays in SETTLING.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';

describe('Calf Raise — never emits not-moving (round 22 hold model)', () => {
  it('does NOT fire not-moving after 8 s of flat-foot stillness post-calibration', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.warnings.filter((w) => w.type === 'not-moving').length).toBe(0);
  });
});
