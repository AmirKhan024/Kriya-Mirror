/**
 * Overhead Press — warning gating: Fix A ensures lower-back-arch and
 * bar-path-drift do NOT fire while in RACKED state (between reps).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;

describe('Overhead Press — warning gating during RACKED state (Fix A)', () => {
  it('back arch injected while RACKED fires ZERO lower-back-arch warnings', () => {
    // Never actually press — stay racked the entire time with a large arch offset
    const TOTAL_MS = CAL_MS + 5000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => ({
        elbowFlexionDeg: RACKED_FLEX,
        backArchOffset: tMs < CAL_MS ? 0 : 0.12,  // large arch, no pressing
      }),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should NOT emit lower-back-arch while in RACKED state
    expect(countWarnings(result, 'lower-back-arch')).toBe(0);
  });

  it('bar path drift injected while RACKED fires ZERO bar-path-drift warnings', () => {
    // Never press, but drift the wrists — should be silent
    const TOTAL_MS = CAL_MS + 5000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => ({
        elbowFlexionDeg: RACKED_FLEX,
        barPathDrift: tMs < CAL_MS ? 0 : 0.10,  // large drift, no pressing
      }),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should NOT emit bar-path-drift while in RACKED state
    expect(countWarnings(result, 'bar-path-drift')).toBe(0);
  });
});
