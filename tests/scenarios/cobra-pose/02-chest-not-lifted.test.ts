/**
 * The single recoverable form-break: the chest dropping (torso elevation falling
 * below ELEV_HOLD_MIN=14 but staying above ELEV_REST=6). It fires
 * `chest-not-lifted` after the 6-frame entry debounce (Fix V) and FREEZES the
 * timer (Fix S) — it must NOT terminate the hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCobraPosePose } from '../../harness/pose-stub';
import { runCobraPoseSession, countWarnings } from '../../harness/runner';
import type { CobraPosePoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Cobra Pose — chest-not-lifted warning', () => {
  it('fires chest-not-lifted when the chest drops, without breaking the hold', () => {
    const frames = buildFrames(
      (tMs): CobraPosePoseIntent => tMs < CAL_MS
        ? { elevationDeg: 28, side: 'left' }
        : { elevationDeg: 10, side: 'left' },
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'chest-not-lifted')).toBeGreaterThan(0);
    // 10° is dropped but above the 6° lay-flat threshold → recoverable.
    expect(result.broken).toBe(false);
  });

  it('stays silent on a clean lifted hold', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 26, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.warnings.length).toBe(0);
  });
});
