/**
 * Round 20 — `not-moving` idle prompt for hold-based engines.
 *
 * When the user is out of pose (form-broken) for ≥ 5 s, a `not-moving`
 * warning fires. Repeats every 15 s while still broken. Re-arms once form
 * recovers. Goal: tell the user "you're not engaging the pose — start" even
 * after the initial form-break chip has fired and gone quiet.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Mountain Pose — not-moving idle prompt (round 20)', () => {
  it('fires not-moving after 5 s of sustained form-break', () => {
    // Cal confirms with arms overhead, then user drops arms at t=hold+1s and
    // stays out of pose. By t=hold+7s, not-moving should have fired ≥ 1 time.
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const armsRaised = intoHold < 1000;  // cal-confirm with arms up, then drop
        return { armsRaised };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('repeats not-moving every ~15 s while still broken', () => {
    // 25 s of sustained form-break (arms dropped). First fire at ~6 s,
    // second at ~21 s → expect ≥ 2 not-moving warnings.
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const armsRaised = intoHold < 1000;
        return { armsRaised };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 25_000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when form recovers within 5 s', () => {
    // Brief 3 s form-break, then back to pose.
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Cal-confirm window: arms up. Then drop for 3 s. Then back up.
        const armsRaised = !(intoHold >= 1000 && intoHold < 4000);
        return { armsRaised };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
