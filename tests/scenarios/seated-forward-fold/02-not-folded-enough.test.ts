/**
 * The single recoverable form-break: coming up out of the fold (torso fold
 * angle dropping below FOLD_HOLD_MIN=45 but staying above STAND_BROKEN=25). It
 * fires `not-folded-enough` after the 6-frame entry debounce (Fix V) and FREEZES
 * the timer (Fix S) — it must NOT terminate the hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedForwardFoldPose } from '../../harness/pose-stub';
import { runSeatedForwardFoldSession, countWarnings } from '../../harness/runner';
import type { SeatedForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Seated Forward Fold — not-folded-enough warning', () => {
  it('fires not-folded-enough when the torso comes up out of the fold (no hold-broken)', () => {
    const frames = buildFrames(
      (tMs): SeatedForwardFoldPoseIntent => tMs < CAL_MS
        ? { foldAngleDeg: 65, side: 'left' }
        : { foldAngleDeg: 10, side: 'left' },
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-folded-enough')).toBeGreaterThan(0);
    // 10° is shallow (< FOLD_HOLD_MIN 14) but above the 8° sit-up threshold → recoverable.
    expect(result.broken).toBe(false);
  });

  it('stays silent on a clean deep hold', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 68, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.warnings.length).toBe(0);
  });
});
