import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, warningsOtherThan } from '../../harness/runner';

// 2.2 s calibration in TOP position (arms straight), then N reps. Each rep:
//   0–1000 ms : lower 0° → 90° elbow flexion
//   1000–1500 : hold at bottom
//   1500–2500 : push 90° → 0°
//   2500–3000 : rest at top
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) {
        return { elbowFlexionDeg: 0, side: 'left' as const };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let elbowFlex: number;
      if (tInRep < 1000) elbowFlex = (tInRep / 1000) * 90;
      else if (tInRep < 1500) elbowFlex = 90;
      else if (tInRep < 2500) elbowFlex = 90 - ((tInRep - 1500) / 1000) * 90;
      else elbowFlex = 0;
      return { elbowFlexionDeg: elbowFlex, side: 'left' as const };
    },
  };
}

describe('Push-Up — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildPushupPose, { fps: 30, durationMs: totalMs });

    const result = runPushupSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildPushupPose, { fps: 30, durationMs: totalMs });
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('also works on the right side (camera flipped)', () => {
    const calMs = 2200;
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { elbowFlexionDeg: 0, side: 'right' as const };
        const t = (tMs - calMs) % repCycleMs;
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 90;
        else if (t < 1500) flex = 90;
        else if (t < 2500) flex = 90 - ((t - 1500) / 1000) * 90;
        else flex = 0;
        return { elbowFlexionDeg: flex, side: 'right' as const };
      },
      buildPushupPose,
      { fps: 30, durationMs: calMs + 5 * repCycleMs },
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
