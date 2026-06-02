/**
 * Form warnings — both reuse existing WarningTypes:
 *   - `incomplete-bend`  : lateral lean drops below ~14° (came up out of the bend)
 *   - `arms-not-overhead`: the top arm drops toward shoulder height
 * Both are recoverable (freeze the timer, not terminal). Fix V hysteresis
 * means a momentary dip does NOT fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, countWarnings } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Gate Pose — form warnings', () => {
  it('fires incomplete-bend when the torso comes up out of the side bend', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const leanDeg = intoHold < 3000 ? 30 : 5;
        return { bendSide: 'right', leanDeg };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires arms-not-overhead when the top arm drops', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const topArmUp = intoHold < 3000;
        return { bendSide: 'right', topArmUp };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGatePoseSession(frames);
    expect(countWarnings(result, 'arms-not-overhead')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire on a clean steady hold', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runGatePoseSession(frames);
    expect(countWarnings(result, 'incomplete-bend')).toBe(0);
    expect(countWarnings(result, 'arms-not-overhead')).toBe(0);
  });

  it('momentary bend dip (4 frames) does NOT fire (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const isSpike = intoHold >= 2000 && intoHold <= 2120;
        return { bendSide: 'right', leanDeg: isSpike ? 5 : 30 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runGatePoseSession(frames);
    expect(countWarnings(result, 'incomplete-bend')).toBe(0);
  });
});
