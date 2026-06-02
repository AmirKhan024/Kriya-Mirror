/**
 * Inchworm — position-lost detection (Fix N).
 * Fire position-lost when no usable landmarks for ≥ 3s post-calibration.
 * Repeat every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildInchwormPose } from '../../harness/pose-stub';
import { runInchwormSession, countWarnings } from '../../harness/runner';
import type { InchwormPoseIntent } from '../../harness/types';
import type { Frame } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
    buildInchwormPose,
    { fps: 30, durationMs },
  );
}

function nullFrames(durationMs: number, startAt = 0): Frame[] {
  const frames: Frame[] = [];
  const dt = 1000 / 30;
  for (let t = 0; t < durationMs; t += dt) {
    frames.push({ landmarks: null, tMs: startAt + t });
  }
  return frames;
}

describe('Inchworm — position-lost detection', () => {
  it('fires position-lost after 3s of no visible landmarks post-calibration', () => {
    const calFrames = standingFrames(500);
    const lostFrames = nullFrames(4000);  // 4s lost — should fire at ~3s mark
    const frames = concatFrames(calFrames, lostFrames);
    const result = runInchwormSession(frames);

    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire position-lost if user steps back in within 3s', () => {
    const calFrames = standingFrames(500);
    const lostFrames = nullFrames(1500);  // only 1.5s lost — under 3s threshold
    const backFrames = standingFrames(500);
    const frames = concatFrames(calFrames, lostFrames, backFrames);
    const result = runInchwormSession(frames);

    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost before calibration confirms', () => {
    // Only null frames — calibration never confirms, position-lost should not fire
    const frames: Frame[] = [];
    for (let t = 0; t < 5000; t += 33) {
      frames.push({ landmarks: null, tMs: t });
    }
    const result = runInchwormSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('resumes counting reps after position regained', () => {
    const calFrames = standingFrames(500);
    const lostFrames = nullFrames(4000);
    // After returning, do a valid rep
    const repFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65 };
        if (tMs < 1500) return { hipHingeDeg: 65 };
        return { hipHingeDeg: 65 - ((tMs - 1500) / 1000) * 65 };
      },
      buildInchwormPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, lostFrames, repFrames);
    const result = runInchwormSession(frames);

    // Position-lost should have fired (3s+ gap)
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
    // After returning, a rep should be counted
    expect(result.completedReps.length).toBe(1);
  });
});
