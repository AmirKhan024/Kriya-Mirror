/**
 * Round 20 — `not-moving` idle prompt for tree-pose.
 *
 * Fires when form has been broken for ≥ 5 s; repeats every 15 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession, countWarnings } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Tree Pose — not-moving idle prompt (round 20)', () => {
  it('fires not-moving after 5 s of sustained form-break (foot off leg)', () => {
    const frames = buildFrames(
      (tMs): TreePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Cal-confirm with foot on leg, then foot drifts off (form-break).
        const offset = intoHold < 1000 ? 0 : 0.15;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('repeats not-moving every ~15 s while still broken', () => {
    const frames = buildFrames(
      (tMs): TreePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = intoHold < 1000 ? 0 : 0.15;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 25_000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      (): TreePosePoseIntent => ({ liftedSide: 'left' }),
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when form recovers within 5 s', () => {
    const frames = buildFrames(
      (tMs): TreePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = (intoHold >= 1000 && intoHold < 4000) ? 0.15 : 0;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
