/**
 * Regression tests for round-6 fixes surfaced by Amir's 2026-05-25 physical
 * test (`pushup_consolelogs.txt`):
 *
 *   Issue 1 — spine-misaligned fired on every rep (12° threshold too tight,
 *             geometrically coupled to HIP_SAG_THRESHOLD).
 *             Fix: SPINE_DEVIATION_DEG 12 → 22.
 *
 *   Issue 2 — 3-second normal-tempo reps got rejected as ballistic because
 *             single-frame MediaPipe jitter at side-view spikes shoulder Y
 *             velocity past 1.5. Fix: MAX_SHOULDER_VELOCITY 1.5 → 3.0.
 *
 *   Issue 3 — 11-second "stuck mid-rep" hesitations rejected as ballistic
 *             (wrong reason). Fix: new `too-slow` reject reason via
 *             MAX_REP_DURATION_MS=6000 (still routes to malformed-rep chip).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, countWarnings } from '../../harness/runner';
import type { PushupPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Push-Up — round 6 physical-test feedback', () => {
  it('does NOT fire spine-misaligned on a clean rep (Issue 1: was firing every rep)', () => {
    // Single clean rep, normal pace, default hipDelta=0, no spine kink.
    // Pre-round-6: spine-misaligned would fire because the 12° threshold was
    // geometrically coupled to HIP_SAG_THRESHOLD. Post-fix (22°): zero.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0, side: 'left' as const } as PushupPoseIntent;
        const tInRep = (tMs - CAL_MS) % 3000;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 90;
        else flex = 0;
        return { elbowFlexionDeg: flex, side: 'left' as const } as PushupPoseIntent;
      },
      buildPushupPose,
      { fps: 30, durationMs: CAL_MS + 3 * 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(3);
    expect(countWarnings(result, 'spine-misaligned')).toBe(0);
  });

  it('counts a 3-second rep with mild jitter (Issue 2: was getting mis-rejected as ballistic)', () => {
    // Normal-tempo rep cycle (1000ms descent + 500ms bottom + 1000ms ascent +
    // 500ms rest) with mild MediaPipe-style noise (σ=0.008). Pre-round-6,
    // single-frame jitter would push peak shoulder velocity past 1.5 even on
    // normal-speed reps. Post-fix (3.0 ceiling): clean reps count.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 0, side: 'left' as const, noise: 0.008, seed: 7 } as PushupPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % 3000;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 90;
        else flex = 0;
        return { elbowFlexionDeg: flex, side: 'left' as const, noise: 0.008, seed: 7 } as PushupPoseIntent;
      },
      buildPushupPose,
      { fps: 30, durationMs: CAL_MS + 5 * 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects 8-second "hesitation" reps with too-slow reason (Issue 3)', () => {
    // One rep cycle: 1s ramp to 90° → 6s sustained at 90° (stuck) → 1s ascent.
    // Total active rep duration = 8s, well past the new MAX_REP_DURATION_MS=6000.
    // Pre-round-6 this would have rejected as ballistic (or completed with a
    // low score); post-fix it rejects via the new `too-slow` path → malformed-rep.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0, side: 'left' as const } as PushupPoseIntent;
        const tAfter = tMs - CAL_MS;
        let flex: number;
        if (tAfter < 1000) flex = (tAfter / 1000) * 90;
        else if (tAfter < 7000) flex = 90;                // stuck at the bottom for 6s
        else if (tAfter < 8000) flex = 90 - ((tAfter - 7000) / 1000) * 90;
        else flex = 0;
        return { elbowFlexionDeg: flex, side: 'left' as const } as PushupPoseIntent;
      },
      buildPushupPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
