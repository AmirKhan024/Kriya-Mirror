/**
 * Fix S split — only the FULL V collapse (both torso AND legs flat = user lay /
 * sat out of the boat) terminates the hold. A single dropped segment is
 * recoverable (freeze).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession, countWarnings } from '../../harness/runner';
import type { BoatPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Boat Pose — hold-broken (Fix S full-collapse terminal)', () => {
  it('terminates ONCE when the whole V collapses (both torso + legs flat)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const collapsed = intoHold >= 4000;
        return {
          torsoAngleDeg: collapsed ? 8 : 45,
          legAngleDeg: collapsed ? 6 : 40,
        };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on a brief full-collapse blip (< debounce window)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // A ~250 ms collapse blip (≈ 8 frames < 12-frame debounce) then recover.
        const blip = intoHold >= 3000 && intoHold < 3250;
        return { torsoAngleDeg: blip ? 8 : 45, legAngleDeg: blip ? 6 : 40 };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate when only the legs drop (chest still lifted)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { torsoAngleDeg: 45, legAngleDeg: intoHold < 3000 ? 40 : 15 };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'legs-dropped')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
