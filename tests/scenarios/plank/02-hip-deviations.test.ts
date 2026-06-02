import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPlankPose } from '../../harness/pose-stub';
import { runPlankSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Plank — hip sag detection', () => {
  it('fires hip-sag warning when hip drops persistently past threshold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        // After calibration, hip sags by 0.06 (past HIP_SAG_THRESHOLD=0.04)
        return { hipDelta: 0.06, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runPlankSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
  });

  it('does NOT fire hip-sag for a momentary 4-frame sag', () => {
    // Sag for only 4 frames (below NO_FORM_OK_FRAMES=6)
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const inSagWindow = tAfter >= 2000 && tAfter < 2120; // ~3-4 frames at 30fps
        return { hipDelta: inSagWindow ? 0.06 : 0, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runPlankSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });
});

describe('Plank — hip pike detection', () => {
  it('fires hip-pike warning when hip rises persistently past threshold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        return { hipDelta: -0.06, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runPlankSession(frames);
    expect(countWarnings(result, 'hip-pike')).toBeGreaterThan(0);
  });
});

describe('Plank — hold broken', () => {
  it('detects hold broken when shoulder rises (user stands up)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { hipDelta: 0, side: 'left' as const };
        // After 3s of clean plank, user stands up (shoulder rises by 0.25)
        return { hipDelta: 0, shoulderRise: 0.25, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runPlankSession(frames);
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(result.brokenAtMs!).toBeGreaterThan(CAL_MS + 2500);
    expect(result.brokenAtMs!).toBeLessThan(CAL_MS + 4000);
  });
});
