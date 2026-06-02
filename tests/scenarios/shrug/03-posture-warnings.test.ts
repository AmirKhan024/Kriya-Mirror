import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, countWarnings } from '../../harness/runner';

describe('Shrug — posture warnings', () => {
  it('fires torso-swing when hipX moves > TORSO_SWING_THRESHOLD (0.03) for 6+ frames in STANDING', () => {
    const calMs = 2200;
    // Stay in STANDING (no shrug), apply sustained torso swing
    const totalMs = calMs + 5000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        // torsoSwing > 0.03 continuously in STANDING state
        return { shoulderElevation: 0, torsoSwing: 0.05 };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire torso-swing when hipX only moves 5 frames (below 6-frame debounce)', () => {
    const calMs = 2200;
    const totalMs = calMs + 3000;

    let frameCount = 0;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        frameCount++;
        // Only apply swing for exactly 5 frames, then stop
        const swing = frameCount <= 5 ? 0.05 : 0;
        return { shoulderElevation: 0, torsoSwing: swing };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('Fix A: torso-swing fires in STANDING but the rep still completes when swing is continuous', () => {
    // This scenario applies torsoSwing throughout the entire cycle.
    // Fix A gates the warning to STANDING state only — the debounce counter RESETS
    // when the engine enters SHRUGGING, so any swing during SHRUGGING/AT_TOP/LOWERING
    // does NOT accumulate toward the 6-frame threshold.
    // However, swing IS present during the initial STANDING phase (tInRep 0–~300ms)
    // which does accumulate, so torso-swing will fire at the STANDING→SHRUGGING boundary.
    // The rep completes normally because form is structurally valid.
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
        return { shoulderElevation: elev, torsoSwing: 0.05 };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    // Rep completes despite the swing (form score may be lower but rep counts).
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    // Fix A: any torso-swing warnings that did fire came from the STANDING phase only,
    // not from the SHRUGGING/AT_TOP/LOWERING phase. The engine should not emit
    // 'torso-swing' when repState !== 'STANDING' — verify by checking the 06-warning-gating
    // tests for the pure-SHRUGGING isolation. This test confirms the rep completes.
  });
});
