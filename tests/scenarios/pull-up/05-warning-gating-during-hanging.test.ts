/**
 * Fix A: posture warnings (shoulder-shrug) are gated to active rep phase.
 * While in HANGING state (dead hang between reps), shrug should not fire
 * even if the ear-shoulder gap is small.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, countWarnings } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Pull-Up — warning gating during HANGING state (Fix A)', () => {
  it('does NOT fire shoulder-shrug while hanging between reps', () => {
    // Calibrate, then hold at dead hang (flex=0) WITH shrug posture.
    // No rep phase → shoulder-shrug gate is never active → no warning.
    const frames = buildFrames(
      (tMs) => {
        const intent: PullUpPoseIntent = {
          elbowFlexionDeg: 0,
          shrugAmount: tMs >= CAL_MS ? 0.08 : 0, // shrug only post-calibration
        };
        return intent;
      },
      buildPullUpPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'shoulder-shrug')).toBe(0);
  });

  it('fires shoulder-shrug once the rep becomes active (PULLING state)', () => {
    // Calibrate, then start a rep with shrug throughout.
    const CAL = 2200;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL) return { elbowFlexionDeg: 0 } as PullUpPoseIntent;
        const t = tMs - CAL;
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 130;
        else if (t < 1500) flex = 130;
        else if (t < 2500) flex = 130 - ((t - 1500) / 1000) * 130;
        else flex = 0;
        return { elbowFlexionDeg: flex, shrugAmount: 0.08 } as PullUpPoseIntent;
      },
      buildPullUpPose,
      { fps: 30, durationMs: CAL + 3500 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'shoulder-shrug')).toBeGreaterThan(0);
  });
});
