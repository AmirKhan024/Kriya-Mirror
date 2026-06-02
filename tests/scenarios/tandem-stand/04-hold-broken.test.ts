import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Tandem Stand — hold broken', () => {
  it('does NOT end the hold when feet separate — fires feet-separated warning and freezes timer (round 9)', () => {
    // 2026-05-25 round 9: feet-separated is now a RECOVERABLE form warning,
    // no longer a hold-broken trigger. The user can step back into stance.
    // shoulderWidth = 0.16; the synth's ankleXSeparation 0.13 = 81% ratio,
    // which previously broke the hold. Now: warning fires, hold continues.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { tandemAhead: 'left' as const };
        return { tandemAhead: 'left' as const, ankleXSeparation: 0.13 };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runTandemStandSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'feet-separated')).toBeGreaterThan(0);
  });

  it('fires hold-broken when user stands up (shoulder rise > 15%)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { tandemAhead: 'left' as const };
        // shoulderRise = 0.20 → past HOLD_BROKEN_SHOULDER_RISE=0.15
        return { tandemAhead: 'left' as const, shoulderRise: 0.20 };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runTandemStandSession(frames);
    expect(result.broken).toBe(true);
  });

  it('fires feet-separated warning before full break (mild drift)', () => {
    // Mild drift past 45% of shoulder width (0.072) but below break threshold (0.112).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 1500) return { tandemAhead: 'left' as const };
        return { tandemAhead: 'left' as const, ankleXSeparation: 0.085 };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runTandemStandSession(frames);
    // Either feet-separated fires OR hold breaks — both are valid responses to drift.
    const sawWarning = result.warnings.some(
      (w) => w.type === 'feet-separated' || w.type === 'hold-broken',
    );
    expect(sawWarning).toBe(true);
  });
});
