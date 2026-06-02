/**
 * Fix S split — only shoulder rise > 15 % terminates the hold (user fully
 * stood up). All form warnings (leg-not-straight, top-arm-not-vertical,
 * bottom-arm-not-down) freeze the timer but don't terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTrianglePosePose } from '../../harness/pose-stub';
import { runTrianglePoseSession, countWarnings } from '../../harness/runner';
import type { TrianglePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Triangle Pose — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.22;
        return { shoulderRise };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on leg-not-straight alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 3000 ? 5 : 45;
        return { frontKneeFlexionDeg: flex };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on bottom-arm-not-down alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lift = intoHold < 3000 ? 0 : 0.40;
        return { bottomArmLiftFromAnkle: lift };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'bottom-arm-not-down')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
