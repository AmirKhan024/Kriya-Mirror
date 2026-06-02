import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, countWarnings } from '../../harness/runner';
import type { PushupPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<PushupPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0, side: 'left' as const } as PushupPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, side: 'left' as const, ...repCycle(tInRep) } as PushupPoseIntent;
    },
    buildPushupPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Push-Up — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_DEPTH)', () => {
    // Peak input flex ≈ 35° (well below the 50° threshold even with EMA catch-up).
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 35;
        else if (t < 1500) flex = 35;
        else if (t < 2500) flex = 35 - ((t - 1500) / 1000) * 35;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      5,
      3000,
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(0);
    // Shallow reps emit incomplete-pushup (actionable user feedback)
    expect(countWarnings(result, 'incomplete-pushup')).toBeGreaterThan(0);
  });

  it('rejects ballistic reps (40 ms each direction, 130° peak)', () => {
    // 40ms descent + 40ms ascent with 130° peak. At 30fps, the LOWERING-state
    // frame-to-frame velocity buffer captures the reversal: shoulder Y delta
    // of ~0.11 normalized units in 33ms = ~3.45 nu/sec, past the round-6
    // MAX_SHOULDER_VELOCITY=3.0 ceiling (was 1.5 pre-round-6; raised to
    // filter single-frame MediaPipe jitter at the side-camera).
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 40) flex = (t / 40) * 130;
        else if (t < 80) flex = 130 - ((t - 40) / 40) * 130;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      5,
      900,
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(0);
    // Either gate is fine here — both mean the user got actionable feedback.
    const rejectionWarnings = countWarnings(result, 'malformed-rep')
      + countWarnings(result, 'incomplete-pushup');
    expect(rejectionWarnings).toBeGreaterThan(0);
  });

  it('rejects unilateral reps (only one arm bends)', () => {
    const frames = makeFrames(
      (t) => {
        let flexL = 0;
        if (t < 1000) flexL = (t / 1000) * 90;
        else if (t < 1500) flexL = 90;
        else if (t < 2500) flexL = 90 - ((t - 1500) / 1000) * 90;
        return { elbowFlexionDeg: flexL, leftElbowFlexionDeg: flexL, rightElbowFlexionDeg: 0 };
      },
      3,
      3000,
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('accepts a valid rep at the minimum-depth boundary (65° + 1.5 s)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 65;
        else if (t < 1200) flex = 65;
        else if (t < 2000) flex = 65 - ((t - 1200) / 800) * 65;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      3,
      2500,
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
