/**
 * Tree-Pose-specific `foot-off-leg` warning. Lifted ankle X drifts away from
 * the standing-knee X by more than FOOT_ON_LEG_X_TOLERANCE = 0.06 for 6+
 * frames (Fix V hysteresis) → warning fires, timer freezes (Fix S recoverable).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession, countWarnings } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Tree Pose — foot-off-leg warning', () => {
  it('fires foot-off-leg when the lifted foot drifts off the standing leg', () => {
    const frames = buildFrames(
      (tMs): TreePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 3s clean → foot drifts 0.12 away from standing knee (well past 0.06)
        const offset = intoHold < 3000 ? 0 : 0.12;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'foot-off-leg')).toBeGreaterThan(0);
    expect(result.broken).toBe(false); // recoverable, not terminal
  });

  it('does NOT fire foot-off-leg when foot stays within tolerance (0.04 offset)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftedAnkleXOffset: 0.04 } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'foot-off-leg')).toBe(0);
  });

  it('momentary foot drift (4 frames) does NOT trigger the warning (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): TreePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 4-frame spike (~133 ms at 30 fps) of bad offset, then back to clean.
        const isSpike = intoHold >= 1500 && intoHold <= 1633;
        return { liftedSide: 'left', liftedAnkleXOffset: isSpike ? 0.12 : 0 };
      },
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 4000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'foot-off-leg')).toBe(0);
  });
});
