/**
 * Engine-local runtime distance monitor (owner request): nudges too-far during
 * the hold when the user drifts back, sustained ~1 s before firing.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, countWarnings } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Gate Pose — runtime distance nudge', () => {
  it('fires too-far when the user drifts too far mid-hold (small body height)', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        return intoHold < 3000
          ? { bendSide: 'right' }
          : { bendSide: 'right', bodyHeight: 0.35 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'too-far')).toBeGreaterThan(0);
  });

  it('does NOT fire any distance nudge on a clean, well-framed hold', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runGatePoseSession(frames);
    expect(countWarnings(result, 'too-far')).toBe(0);
    expect(countWarnings(result, 'too-close')).toBe(0);
  });
});
