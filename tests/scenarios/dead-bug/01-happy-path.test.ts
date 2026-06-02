import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadBugPose } from '../../harness/pose-stub';
import { runDeadBugSession, countWarnings } from '../../harness/runner';
import type { DeadBugPoseIntent } from '../../harness/types';

// Calibration phase: ~300ms at 30fps = ~9 frames with legExtensionDeg=0, armsUp=true
// Rep cycle: 0→60→0 over 1200ms
//   0–600ms: extend 0° → 60°
//   600–1200ms: return 60° → 0°
function happyPathIntent(reps: number) {
  const calMs = 500; // generous calibration window (~300ms needed)
  const repCycleMs = 1200;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): DeadBugPoseIntent => {
      if (tMs < calMs) {
        return { legExtensionDeg: 0, armsUp: true };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let extensionDeg: number;
      if (tInRep < 600) {
        // extending: 0° → 60°
        extensionDeg = (tInRep / 600) * 60;
      } else {
        // returning: 60° → 0°
        extensionDeg = 60 - ((tInRep - 600) / 600) * 60;
      }
      return { legExtensionDeg: extensionDeg, armsUp: true };
    },
  };
}

describe('Dead Bug — happy path', () => {
  it('calibrates within 500ms and counts 3 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildDeadBugPose, { fps: 30, durationMs: totalMs });

    const result = runDeadBugSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    result.completedReps.forEach((rep) => {
      expect(rep.mqs).toBeGreaterThanOrEqual(50);
    });
    expect(countWarnings(result, 'incomplete-dead-bug')).toBe(0);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildDeadBugPose, { fps: 30, durationMs: totalMs });
    const result = runDeadBugSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
  });

  it('calibration state is confirmed after calibration phase', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildDeadBugPose, { fps: 30, durationMs: totalMs });
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
  });

  it('all 3 reps score mqs >= 50', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildDeadBugPose, { fps: 30, durationMs: totalMs });
    const result = runDeadBugSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    const first3 = result.completedReps.slice(0, 3);
    first3.forEach((rep) => {
      expect(rep.mqs).toBeGreaterThanOrEqual(50);
    });
  });
});
