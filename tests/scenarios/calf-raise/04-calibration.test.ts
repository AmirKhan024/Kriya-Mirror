import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Calf Raise — calibration gates', () => {
  it('confirms within 2.2s when all gates pass (flat-foot standing)', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the feetHipWidth gate when feet are wider than 1.5× shoulders', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0, feetWidthRatio: 1.7 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the feetHipWidth gate when feet are narrower than 0.5× shoulders', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0, feetWidthRatio: 0.3 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0, occludedIndices: [IDX.leftAnkle] }),
      buildCalfRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  // Fix X (cal side) — narrow shoulderWidth rejection.
  // MediaPipe's bad-frame baselines (shoulderWidth ≈ 0.024) collapse every
  // runtime distance-normalized threshold. Reject baselines below 0.08 with
  // a `too-far` hint so the user re-positions instead of locking in a
  // degenerate baseline.
  it('rejects calibration with degenerate shoulderWidth (Fix X cal side)', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0, shoulderWidthOverride: 0.05 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

});
