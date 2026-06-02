/**
 * 2026-05-31 physical-test fix: Down Dog must keep the LEGS and ARMS straight
 * (it's an inverted-V peak). Two recoverable form-breaks freeze the timer:
 *   - leg-not-straight  : knee flexion past KNEE_BENT_MAX_DEG (28°)
 *   - arms-not-straight : elbow flexion past ARM_BENT_MAX_DEG (28°)
 * Minor bend/sway (within tolerance) must NOT trip them; neither terminates.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession, countWarnings } from '../../harness/runner';
import type { DownwardDogPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Downward Dog — leg + arm straightness', () => {
  it('fires leg-not-straight when the knees bend clearly (no hold-broken)', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent => tMs < CAL_MS
        ? { apexAngleDeg: 90, side: 'left' }
        : { apexAngleDeg: 90, kneeFlexionDeg: 50, side: 'left' },
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires arms-not-straight when the arms bend clearly (no hold-broken)', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent => tMs < CAL_MS
        ? { apexAngleDeg: 90, side: 'left' }
        : { apexAngleDeg: 90, armFlexionDeg: 50, side: 'left' },
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'arms-not-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('tolerates minor bend/sway (within ~28°) with no warning', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 92, kneeFlexionDeg: 20, armFlexionDeg: 20, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.warnings.length).toBe(0);
  });
});
