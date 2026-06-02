import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, countWarnings } from '../../harness/runner';

describe('Shrug — not-moving (init)', () => {
  it('cal-confirm seeds idle tracking; 5s STANDING idle triggers not-moving', () => {
    const calMs = 2200;
    // After calibration: stay completely still for 7 seconds
    const idleMs = 7000;
    const totalMs = calMs + idleMs;

    const frames = buildFrames(
      (tMs) => {
        return { shoulderElevation: 0 };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('cold-start sentinel: not-moving does not fire before calibration', () => {
    // Occlusion before calibration — engine should be silent
    const frames = buildFrames(
      () => null,
      buildShrugPose,
      { fps: 30, durationMs: 8000 },
    );

    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
