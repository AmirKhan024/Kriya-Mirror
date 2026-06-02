import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, countWarnings } from '../../harness/runner';

/**
 * Fix I + Fix P regression: the idle timer must initialize on calibration-
 * confirm (not at engine construction), and the cold-start cooldown must allow
 * the FIRST `not-moving` warning to fire after NO_MOVEMENT_TIMEOUT_MS (5s).
 */
describe('Overhead Tricep Extension — not-moving init (Fix I + Fix P)', () => {
  it('fires not-moving after 5s+ of post-calibration idle', () => {
    // Enough frames for calibration to confirm then idle for well over 5s.
    // Instant calibration (~200-500ms) then 10s of no motion.
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0 }),
      buildOTEPose,
      { fps: 30, durationMs: 12000 },
    );

    const result = runOTESession(frames);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
    // Warning must come after calibration confirmed
    const cal = result.calibrationConfirmedAtMs!;
    const notMovingWarning = result.warnings.find((w) => w.type === 'not-moving');
    expect(notMovingWarning).toBeDefined();
    // Fires at least 5s after calibration (5s idle + any EMA settle time)
    expect(notMovingWarning!.atMs).toBeGreaterThan(cal + 4000);
  });

  it('does NOT fire not-moving only 3s after calibration idle', () => {
    // Cal + 3s total — less than 5s timeout, should not fire
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0 }),
      buildOTEPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runOTESession(frames);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving if user is actively doing reps', () => {
    const calMs = 2200;
    const repCycleMs = 3000;
    const frames = buildFrames(
      (t) => {
        if (t < calMs) return { extensionLevel: 1.0 };
        const tRep = (t - calMs) % repCycleMs;
        const ext = tRep < 1500 ? 1.0 - (tRep / 1500) : (tRep - 1500) / 1500;
        return { extensionLevel: Math.max(0, Math.min(1, ext)) };
      },
      buildOTEPose,
      { fps: 30, durationMs: calMs + 5 * repCycleMs },
    );

    const result = runOTESession(frames);

    expect(result.completedReps.length).toBe(5);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
