/**
 * Recoverable form-break warnings (both FREEZE the timer, neither terminates):
 *   - not-folded-enough : torso came up out of the fold (fold angle below the
 *     hold threshold but still above the stand-up threshold)
 *   - leg-not-straight  : knees bent (the fold is a hip hinge, not a squat)
 * Each fires only after the 6-frame entry debounce (Fix V).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildForwardFoldPose } from '../../harness/pose-stub';
import { runStandingForwardFoldSession, countWarnings } from '../../harness/runner';
import type { ForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Standing Forward Fold — form warnings', () => {
  it('fires not-folded-enough when the torso comes up out of the fold (no hold-broken)', () => {
    const frames = buildFrames(
      (tMs): ForwardFoldPoseIntent => tMs < CAL_MS
        ? { foldAngleDeg: 75, side: 'left' }
        : { foldAngleDeg: 40, side: 'left' },
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-folded-enough')).toBeGreaterThan(0);
    // 40° is shallow but well above the 30° stand-up threshold → recoverable.
    expect(result.broken).toBe(false);
  });

  it('fires leg-not-straight when the knees bend in the fold', () => {
    const frames = buildFrames(
      (tMs): ForwardFoldPoseIntent => tMs < CAL_MS
        ? { foldAngleDeg: 75, kneeFlexionDeg: 5, side: 'left' }
        : { foldAngleDeg: 75, kneeFlexionDeg: 55, side: 'left' },
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('stays silent on a clean deep hold', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 78, kneeFlexionDeg: 6, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.warnings.length).toBe(0);
  });
});
