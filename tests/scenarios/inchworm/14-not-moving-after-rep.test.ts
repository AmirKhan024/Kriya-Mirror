/**
 * Regression: 'not-moving' must fire after a real rep + idle (Fix O — EMA reseed).
 *
 * Bug: after a rep completes, smoothedHingeDeg decays from ~15° toward 0° over
 * several seconds. This decay tail permanently inflates (max - min), so variance
 * never drops below the 2° gate and 'not-moving' never fires post-rep.
 *
 * Fix: once per-frame Δ < 0.3° for 500ms, reseed standingHingeMin/Max from the
 * current value so the variance accumulator reflects only post-settle jitter.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildInchwormPose } from '../../harness/pose-stub';
import { runInchwormSession, countWarnings } from '../../harness/runner';
import type { InchwormPoseIntent } from '../../harness/types';

describe('Inchworm — regression: not-moving fires after rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Calibration: 500ms standing → one real rep (fold to 65° over 1s, hold 300ms,
    // return over 1s) → 8s of STANDING idle.
    const calFrames = buildFrames(
      (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
      buildInchwormPose,
      { fps: 30, durationMs: 500 },
    );

    const REP_MS = 2300;
    const repFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65 };
        if (tMs < 1300) return { hipHingeDeg: 65 };
        return { hipHingeDeg: 65 - ((tMs - 1300) / 1000) * 65 };
      },
      buildInchwormPose,
      { fps: 30, durationMs: REP_MS },
    );

    const idleFrames = buildFrames(
      (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
      buildInchwormPose,
      { fps: 30, durationMs: 8000 },
    );

    const frames = concatFrames(calFrames, repFrames, idleFrames);
    const result = runInchwormSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // The whole point: idle warning must fire after a rep completes.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
