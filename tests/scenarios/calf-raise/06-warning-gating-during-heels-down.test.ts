/**
 * 2026-05-28 round 22 — replaces the rep-cycle torso-swing gating test. The
 * hold engine has SETTLING → HOLDING → DROPPED states. During SETTLING (the
 * pre-rise phase where the user is still flat-footed), NO warnings should
 * fire — the engine should be silent until the user actually rises.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';

const CAL_MS = 2200;

describe('Calf Raise — silent during SETTLING (round 22)', () => {
  it('does NOT emit ANY warnings if the user never rises after calibration', () => {
    // User calibrates flat-foot then just stands there for 8 s (never lifts).
    // Engine should stay in SETTLING and emit no warnings.
    const frames = buildFrames(
      () => ({ heelRisePct: 0 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.warnings.length).toBe(0);
    expect(result.finalSecondsElapsed).toBe(0);
  });

  it('does NOT emit warnings during the SETTLING phase even with torso sway', () => {
    // Sustained sway during the pre-rise window. Engine doesn't track sway
    // (no torso-swing detector in the round-22 hold engine), and shouldn't
    // fire heel-dropped either since the user hasn't entered HOLDING yet.
    const frames = buildFrames(
      () => ({ heelRisePct: 0, torsoSwayX: 0.06 }),
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(result.warnings.length).toBe(0);
  });
});
