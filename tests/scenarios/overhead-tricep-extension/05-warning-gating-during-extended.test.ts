import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, countWarnings } from '../../harness/runner';

/**
 * Fix A regression: form coaching warnings (elbow-flare, torso-swing) must
 * stay silent while the user is in EXTENDED state (resting between reps).
 *
 * They should fire when the user IS in an active rep phase (LOWERING / AT_BOTTOM / PRESSING).
 */
describe('Overhead Tricep Extension — warning gating (Fix A)', () => {
  it('elbow-flare does NOT fire while user is in EXTENDED (resting) state', () => {
    // User is calibrated and then stands with arms up but elbows flared — NEVER moves.
    const frames = buildFrames(
      (t) => {
        if (t < 2200) return { extensionLevel: 1.0 };
        // Post-cal: stay in EXTENDED (extensionLevel=1.0) with elbow flare
        return { extensionLevel: 1.0, elbowFlareX: 0.08 };
      },
      buildOTEPose,
      { fps: 30, durationMs: 6000 },
    );

    const result = runOTESession(frames);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    // No active rep → elbow-flare should not fire (Fix A)
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });

  it('torso-swing does NOT fire while in EXTENDED state', () => {
    const frames = buildFrames(
      (t) => {
        if (t < 2200) return { extensionLevel: 1.0 };
        return { extensionLevel: 1.0, torsoSwayX: 0.07 };
      },
      buildOTEPose,
      { fps: 30, durationMs: 5000 },
    );

    const result = runOTESession(frames);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('elbow-flare fires when user IS doing a rep with bad elbows', () => {
    // Do one rep with sustained elbow flare throughout
    const frames = buildFrames(
      (t) => {
        if (t < 2200) return { extensionLevel: 1.0 };
        const tRep = t - 2200;
        const ext = tRep < 1500 ? 1.0 - (tRep / 1500) : (tRep - 1500) / 1500;
        return { extensionLevel: ext, elbowFlareX: 0.08 };
      },
      buildOTEPose,
      { fps: 30, durationMs: 5200 },
    );

    const result = runOTESession(frames);

    expect(countWarnings(result, 'elbow-flare')).toBeGreaterThanOrEqual(1);
  });
});
