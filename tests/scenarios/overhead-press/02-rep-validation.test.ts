/**
 * Overhead Press — rep validation: incomplete press, ballistic press,
 * asymmetric arms all get rejected correctly.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;

describe('Overhead Press — rep validation', () => {
  it('emits incomplete-press when arms only reach 50° (no lockout)', () => {
    // Press only to 50° flex (not locked out — minimum lockout threshold is 30°)
    const SHALLOW_PEAK = 50;
    const TOTAL_MS = CAL_MS + 4000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX };
        const tRep = tMs - CAL_MS;
        let flex: number;
        if (tRep < 200)       flex = RACKED_FLEX;
        else if (tRep < 1200) flex = RACKED_FLEX - ((tRep - 200) / 1000) * (RACKED_FLEX - SHALLOW_PEAK);
        else if (tRep < 1700) flex = SHALLOW_PEAK;
        else if (tRep < 2700) flex = SHALLOW_PEAK + ((tRep - 1700) / 1000) * (RACKED_FLEX - SHALLOW_PEAK);
        else                  flex = RACKED_FLEX;
        return { elbowFlexionDeg: flex };
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    // No valid rep should be counted (it was too shallow)
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-press')).toBeGreaterThan(0);
  });

  it('does NOT count a ballistic rep (< MIN_REP_DURATION_MS)', () => {
    // Press and return in 300ms (below MIN_REP_DURATION_MS = 500ms)
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX };
        const tRep = tMs - CAL_MS;
        let flex: number;
        if (tRep < 200) flex = RACKED_FLEX;
        // Ballistic: 75 → 12 in 150ms, return in 150ms
        else if (tRep < 350) flex = RACKED_FLEX - ((tRep - 200) / 150) * (RACKED_FLEX - 12);
        else if (tRep < 500) flex = 12 + ((tRep - 350) / 150) * (RACKED_FLEX - 12);
        else flex = RACKED_FLEX;
        return { elbowFlexionDeg: flex };
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    // Ballistic rep → malformed-rep warning, rep not counted
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('rejects strongly asymmetric arms as malformed-rep', () => {
    // One arm presses all the way, the other barely moves
    const TOTAL_MS = CAL_MS + 5000;
    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX };
        const tRep = tMs - CAL_MS;
        let flex: number;
        if (tRep < 200)       flex = RACKED_FLEX;
        else if (tRep < 1200) flex = RACKED_FLEX - ((tRep - 200) / 1000) * (RACKED_FLEX - 12);
        else if (tRep < 1700) flex = 12;
        else if (tRep < 2700) flex = 12 + ((tRep - 1700) / 1000) * (RACKED_FLEX - 12);
        else                  flex = RACKED_FLEX;
        return {
          // Right arm fully presses (flex=12), left arm barely moves (flex stays at 65)
          elbowFlexionDeg: RACKED_FLEX,
          rightElbowFlexionDeg: flex,
          leftElbowFlexionDeg: Math.max(65, flex),  // left arm barely presses
        };
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    // Asymmetric rep → malformed-rep, not counted
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
