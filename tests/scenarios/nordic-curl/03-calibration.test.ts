/**
 * Nordic Curl — calibration gates
 *
 * Tests:
 * - all gates pass → confirms within 300ms
 * - trunkLean > 20° → armsOverhead gate fails (bodyUpright), no confirm
 * - too close (bodyHeight > 0.92) → distanceOk fails, distanceHint = 'too-close'
 * - too far (bodyHeight < 0.45) → distanceHint = 'too-far'
 * - timeout after 30s → state = 'timeout'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildNordicCurlPose } from '../../harness/pose-stub';
import { runNordicCurlSession } from '../../harness/runner';
import type { NordicCurlPoseIntent } from '../../harness/types';

describe('Nordic Curl — calibration', () => {
  it('confirms within 300ms when all gates pass', () => {
    const frames = buildFrames(
      () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 500 },
    );
    const result = runNordicCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(300);
  });

  it('does not confirm when trunkLean > 20° (bodyUpright gate fails)', () => {
    const frames = buildFrames(
      () => ({ trunkLeanDeg: 35, bodyHeight: 0.60 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 1000 },
    );
    const result = runNordicCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    // armsOverhead gate should be failing
    const lastCal = result.finalCalibration;
    if (lastCal && lastCal.state !== 'confirmed') {
      expect(lastCal.checks.armsOverhead).toBe(false);
    }
  });

  it('emits too-close hint when bodyHeight fraction is too high (> 0.92)', () => {
    // bodyHeight = 0.95 means person fills 95% of the frame → too close
    const frames = buildFrames(
      () => ({ trunkLeanDeg: 0, bodyHeight: 0.95 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 1000 },
    );
    const result = runNordicCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('emits too-far hint when bodyHeight fraction is too low (< 0.45)', () => {
    // bodyHeight = 0.30 means person is very small in the frame → too far
    const frames = buildFrames(
      () => ({ trunkLeanDeg: 0, bodyHeight: 0.30 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 1000 },
    );
    const result = runNordicCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('times out after 30s of failed gates', () => {
    // Feed 31s of invalid pose (leaning too much — armsOverhead gate fails).
    // tMs runs 0..31000, calibration startedAt is performance.now() (~0 in test),
    // so after tMs > 30000 the timeout fires.
    const frames: import('../../harness/types').Frame[] = [];
    for (let t = 0; t <= 31000; t += 500) {
      frames.push({
        landmarks: buildNordicCurlPose({ trunkLeanDeg: 40, bodyHeight: 0.60 } as NordicCurlPoseIntent) as import('@/modules/pose/types').PoseLandmarks,
        tMs: t,
      });
    }
    const result = runNordicCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
  });
});
