/**
 * Overhead Press — posture warnings:
 *   - lower-back-arch fires during active press
 *   - bar-path-drift fires during active press
 *   - Both are gated to active rep phase (not during RACKED rest)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;
const LOCKED_FLEX = 12;
const REP_CYCLE_MS = 3700;

function pressRepIntent(
  tMs: number,
  opts: { backArch?: number; drift?: number } = {},
): OverheadPressPoseIntent {
  if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX };
  const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
  const isPressing = tInRep > 700 && tInRep < 2200;
  let flex: number;
  if (tInRep < 700)       flex = RACKED_FLEX;
  else if (tInRep < 1700) flex = RACKED_FLEX - ((tInRep - 700) / 1000) * (RACKED_FLEX - LOCKED_FLEX);
  else if (tInRep < 2200) flex = LOCKED_FLEX;
  else if (tInRep < 3200) flex = LOCKED_FLEX + ((tInRep - 2200) / 1000) * (RACKED_FLEX - LOCKED_FLEX);
  else                    flex = RACKED_FLEX;
  return {
    elbowFlexionDeg: flex,
    backArchOffset: isPressing ? (opts.backArch ?? 0) : 0,
    barPathDrift: isPressing ? (opts.drift ?? 0) : 0,
  };
}

describe('Overhead Press — posture warnings', () => {
  it('fires lower-back-arch when hips shift forward during press', () => {
    const TOTAL_MS = CAL_MS + REP_CYCLE_MS * 3;
    const frames = buildFrames(
      (tMs) => pressRepIntent(tMs, { backArch: 0.09 }),  // > 0.06 threshold
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBeGreaterThan(0);
  });

  it('fires bar-path-drift when wrist drifts horizontally during press', () => {
    const TOTAL_MS = CAL_MS + REP_CYCLE_MS * 3;
    const frames = buildFrames(
      (tMs) => pressRepIntent(tMs, { drift: 0.07 }),  // > 0.04 threshold
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(countWarnings(result, 'bar-path-drift')).toBeGreaterThan(0);
  });

  it('does NOT fire posture warnings for a clean press (no arch, no drift)', () => {
    const TOTAL_MS = CAL_MS + REP_CYCLE_MS * 3;
    const frames = buildFrames(
      (tMs) => pressRepIntent(tMs, {}),
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBe(0);
    expect(countWarnings(result, 'bar-path-drift')).toBe(0);
  });
});
