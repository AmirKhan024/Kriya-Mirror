/**
 * Boat Pose's two V warnings — recoverable per Fix S (freeze the timer + warn,
 * but do NOT terminate while the other segment is still lifted).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession, countWarnings } from '../../harness/runner';
import type { BoatPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Boat Pose — V form warnings (Fix S recoverable)', () => {
  it('fires legs-dropped when the legs sag (chest still lifted)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { torsoAngleDeg: 45, legAngleDeg: intoHold < 5000 ? 40 : 15 };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'legs-dropped')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires chest-dropped when the chest collapses (legs still lifted)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { torsoAngleDeg: intoHold < 5000 ? 45 : 20, legAngleDeg: 40 };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runBoatPoseSession(frames);
    expect(countWarnings(result, 'chest-dropped')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire any V warning on a clean hold (sanity)', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runBoatPoseSession(frames);
    expect(countWarnings(result, 'legs-dropped')).toBe(0);
    expect(countWarnings(result, 'chest-dropped')).toBe(0);
  });
});
