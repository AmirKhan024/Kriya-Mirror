/**
 * Overhead Press — not-moving idle detection init (Fix I + Fix P):
 *   - Idle tracker initializes on cal-confirm
 *   - First fire at NO_MOVEMENT_TIMEOUT_MS = 5000ms post-confirm
 *   - Cold-start sentinel: lastNoMovementWarnAt = 0, so first fire is allowed
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;

describe('Overhead Press — not-moving init (Fix I + P)', () => {
  it('fires not-moving after 5s of idle post-calibration (cold start)', () => {
    // Calibrate then stand still for 7s
    const TOTAL_MS = CAL_MS + 7000;
    const frames = buildFrames(
      (): OverheadPressPoseIntent => ({ elbowFlexionDeg: RACKED_FLEX }),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving within the first 4s after calibration', () => {
    // Only 4s post-calibration — should not trigger yet (timeout is 5s)
    const TOTAL_MS = CAL_MS + 4000;
    const frames = buildFrames(
      (): OverheadPressPoseIntent => ({ elbowFlexionDeg: RACKED_FLEX }),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
