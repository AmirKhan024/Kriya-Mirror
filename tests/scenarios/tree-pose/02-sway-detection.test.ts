/**
 * Sway detection — mirrors SLS's sway test. Tree Pose uses the same 12°
 * threshold (Fix Z, NOT tandem-stand's 6°) because single-leg poses produce
 * 4–7° of normal CoM sway.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession, countWarnings } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Tree Pose — sway detection', () => {
  it('fires swaying when CoM displacement exceeds the 12° threshold', () => {
    const frames = buildFrames(
      (tMs) => {
        const intoHold = tMs - CAL_MS;
        // Sustained sway via large swayX after cal — passes the 12° threshold.
        const swayX = intoHold > 1500 ? 0.05 : 0;
        return { liftedSide: 'left' as const, swayX } as TreePosePoseIntent;
      },
      buildTreePosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire swaying on a clean steady hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });
});
