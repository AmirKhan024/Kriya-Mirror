/**
 * Fix I + Fix P — the idle `not-moving` prompt fires from a cold start: the
 * user calibrates then stands still without lunging. `standingSince` is seeded
 * on cal-confirm (no instant false positive) and the cold-start cooldown
 * sentinel allows the first fire even when the engine clock is small.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Lunge — not-moving from cold start (Fix I + Fix P)', () => {
  it('fires not-moving after ~5s of standing still post-calibration', () => {
    const frames = buildFrames(
      (): LateralLungePoseIntent => ({ workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true }),
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving instantly on the first post-cal frame', () => {
    const frames = buildFrames(
      (): LateralLungePoseIntent => ({ workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true }),
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runLateralLungeSession(frames);
    // < 5 s of idle after cal → not yet.
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
