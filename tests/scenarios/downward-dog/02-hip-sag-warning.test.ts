/**
 * The single recoverable form-break: hips dropping (the inverted V flattening).
 * The apex angle opening past APEX_HOLD_MAX=115 (but below APEX_BROKEN=150)
 * fires `hip-sag` after the 6-frame entry debounce (Fix V) and FREEZES the
 * timer (Fix S) — it must NOT terminate the hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession, countWarnings } from '../../harness/runner';
import type { DownwardDogPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Downward Dog — hip-sag warning', () => {
  it('fires hip-sag when the hips drop (apex opens), without breaking the hold', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent => tMs < CAL_MS
        ? { apexAngleDeg: 90, side: 'left' }
        : { apexAngleDeg: 135, side: 'left' },
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
    // 135° is sagging but below the 150° collapse threshold → recoverable.
    expect(result.broken).toBe(false);
  });

  it('stays silent on a clean sharp-V hold', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 92, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.warnings.length).toBe(0);
  });
});
