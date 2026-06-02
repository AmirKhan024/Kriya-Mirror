/**
 * Hold-broken: the ONLY terminal condition is laying the chest fully back down
 * (torso elevation below ELEV_REST = 6). A dropped-but-still-lifted chest is
 * recoverable and only freezes the timer.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCobraPosePose } from '../../harness/pose-stub';
import { runCobraPoseSession } from '../../harness/runner';
import type { CobraPosePoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Cobra Pose — hold broken', () => {
  it('ends the hold when the chest lays back flat on the floor', () => {
    const frames = buildFrames(
      (tMs): CobraPosePoseIntent => tMs < CAL_MS
        ? { elevationDeg: 28, side: 'left' }
        : { elevationDeg: 2, side: 'left' },
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
  });

  it('does NOT end the hold while the chest stays lifted', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 26, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.broken).toBe(false);
  });
});
