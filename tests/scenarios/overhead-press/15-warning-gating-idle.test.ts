/**
 * Overhead Press — warning gating during RACKED idle state:
 * form warnings (lower-back-arch, bar-path-drift) must remain silent
 * even when the user has bad posture while idle/resting between reps.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;

describe('Overhead Press — form warnings silent during RACKED idle (Fix A)', () => {
  it('no lower-back-arch warning when arching but not pressing', () => {
    // User is racked + arching throughout — no press attempted
    const TOTAL_MS = CAL_MS + 6000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => ({
        elbowFlexionDeg: RACKED_FLEX,
        backArchOffset: tMs < CAL_MS ? 0 : 0.15,  // bad arch, never presses
      }),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'lower-back-arch')).toBe(0);
  });

  it('no bar-path-drift warning when drifting but not pressing', () => {
    const TOTAL_MS = CAL_MS + 6000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => ({
        elbowFlexionDeg: RACKED_FLEX,
        barPathDrift: tMs < CAL_MS ? 0 : 0.12,  // bad drift, never presses
      }),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'bar-path-drift')).toBe(0);
  });
});
