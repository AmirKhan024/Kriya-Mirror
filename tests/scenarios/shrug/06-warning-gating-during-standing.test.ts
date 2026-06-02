import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, countWarnings } from '../../harness/runner';

describe('Shrug — warning gating (Fix A: torso-swing only in STANDING)', () => {
  it('torso-swing fires when sustained in STANDING state', () => {
    const calMs = 2200;
    const totalMs = calMs + 6000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        // Always in STANDING, sustained torso swing above threshold
        return { shoulderElevation: 0, torsoSwing: 0.05 };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThanOrEqual(1);
  });

  it('torso-swing does NOT fire during SHRUGGING (Fix A)', () => {
    // Only apply torso swing when solidly in SHRUGGING/AT_TOP (tInRep 600-1400ms)
    // At tInRep=600ms, elev~0.030 (above SHRUG_ENTER_THRESHOLD 0.015) — in SHRUGGING.
    // The counter resets to 0 when we enter SHRUGGING, so 6 consecutive STANDING
    // frames cannot accumulate during this window.
    const calMs = 2200;
    const repCycleMs = 3000;
    const totalMs = calMs + repCycleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const tInRep = (tMs - calMs) % repCycleMs;
        let elev: number;
        if (tInRep < 1000) elev = (tInRep / 1000) * 0.05;
        else if (tInRep < 1500) elev = 0.05;
        else if (tInRep < 2500) elev = 0.05 - ((tInRep - 1500) / 1000) * 0.05;
        else elev = 0;
        // Apply torso swing ONLY during SHRUGGING/AT_TOP (solidly above SHRUG_ENTER_THRESHOLD)
        // tInRep=600ms: elev=0.030 → already in SHRUGGING state
        const swing = (tInRep >= 600 && tInRep < 1450) ? 0.05 : 0;
        return { shoulderElevation: elev, torsoSwing: swing };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    // torso-swing should NOT fire — counter is reset to 0 when entering SHRUGGING
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('torso-swing does NOT fire during AT_TOP (Fix A)', () => {
    const calMs = 2200;
    const repCycleMs = 3000;
    const totalMs = calMs + repCycleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const tInRep = (tMs - calMs) % repCycleMs;
        let elev: number;
        if (tInRep < 1000) elev = (tInRep / 1000) * 0.05;
        else if (tInRep < 1500) elev = 0.05;
        else if (tInRep < 2500) elev = 0.05 - ((tInRep - 1500) / 1000) * 0.05;
        else elev = 0;
        // Only apply torso swing AT_TOP (tInRep 1000-1500ms)
        const swing = (tInRep >= 1000 && tInRep < 1500) ? 0.05 : 0;
        return { shoulderElevation: elev, torsoSwing: swing };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('torso-swing does NOT fire during LOWERING (Fix A)', () => {
    const calMs = 2200;
    const repCycleMs = 3000;
    const totalMs = calMs + repCycleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const tInRep = (tMs - calMs) % repCycleMs;
        let elev: number;
        if (tInRep < 1000) elev = (tInRep / 1000) * 0.05;
        else if (tInRep < 1500) elev = 0.05;
        else if (tInRep < 2500) elev = 0.05 - ((tInRep - 1500) / 1000) * 0.05;
        else elev = 0;
        // Only apply torso swing during LOWERING (tInRep 1500-2500ms)
        const swing = (tInRep >= 1500 && tInRep < 2500) ? 0.05 : 0;
        return { shoulderElevation: elev, torsoSwing: swing };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
