/**
 * Idle `not-moving` prompt for Boat Pose: fires when form has been broken (a
 * segment dropped, but not a full collapse) for ≥ 5 s; not on a clean hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession, countWarnings } from '../../harness/runner';
import type { BoatPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Boat Pose — not-moving idle prompt', () => {
  it('fires not-moving after ~5 s of sustained form-break (legs dropped)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Legs sag but stay above the terminal floor (chest stays up) → freeze,
        // not a full collapse → not-moving nudges after 5 s.
        return { torsoAngleDeg: 45, legAngleDeg: intoHold < 1000 ? 40 : 16 };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runBoatPoseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
