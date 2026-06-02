/**
 * Posture warning tests for Chair Dip.
 *
 * Chair Dip has two posture warnings measured during active rep phases:
 *   elbow-flare  — elbowFlareX > 0.07 for 10+ consecutive frames (ELBOW_FLARE_DEBOUNCE_FRAMES=10)
 *   torso-swing  — torsoSwayX  > 0.05 for 8+ consecutive frames  (TORSO_SWING_DEBOUNCE_FRAMES=8)
 *
 * Fix A (warning gating): both warnings must be SILENT during the EXTENDED
 * rest state between reps. Only fire when the engine is in an active dip phase.
 *
 * Cooldown: after elbow-flare fires once, it cannot fire again for 2500ms.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

function dipShoulderDescent(flex: number): number {
  return Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
}

const CAL_MS = 500;

// Helper: build a rep-cycling frame stream. repCycle receives time-in-rep (ms).
function makeFrames(
  repCycle: (tInRep: number) => Partial<ChairDipPoseIntent>,
  reps = 3,
  repCycleMs = 2500,
) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
        ...repCycle(tInRep),
      } as ChairDipPoseIntent;
    },
    buildChairDipPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

// Parametric dip flex for the standard rep shape (5 → 90 → 5).
function dipFlex(t: number, peak = 90): number {
  if (t < 300) return 5;
  if (t < 800) return 5 + ((t - 300) / 500) * (peak - 5);
  if (t < 1000) return peak;
  if (t < 1500) return peak - ((t - 1000) / 500) * (peak - 5);
  return 5;
}

describe('Chair Dip — posture warnings', () => {
  it('Test A: fires elbow-flare when elbowFlareX > 0.07 for 10+ consecutive frames during active rep', () => {
    // elbowFlareX=0.09 (past 0.07 threshold) sustained throughout the dip phase.
    const frames = makeFrames((t) => {
      const flex = dipFlex(t);
      const elbowFlareX = flex > 20 ? 0.09 : 0;
      return { elbowFlexionDeg: flex, elbowFlareX, shoulderDescentY: dipShoulderDescent(flex) };
    }, 3);

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'elbow-flare')).toBeGreaterThan(0);
  });

  it('Test A: elbow-flare respects 2500ms cooldown — second trigger no sooner than 2500ms after first', () => {
    // 3 reps each with elbowFlareX sustained during dip.
    // With a 2500ms rep cycle and 2500ms cooldown, a second warning may or may
    // not fire depending on exact timing; what we assert is the total count
    // does not grow by more than 1 per cooldown window.
    const repCycleMs = 2500;
    const frames = makeFrames(
      (t) => {
        const flex = dipFlex(t);
        const elbowFlareX = flex > 20 ? 0.09 : 0;
        return { elbowFlexionDeg: flex, elbowFlareX, shoulderDescentY: dipShoulderDescent(flex) };
      },
      6,
      repCycleMs,
    );

    const result = runChairDipSession(frames);
    const count = countWarnings(result, 'elbow-flare');
    expect(count).toBeGreaterThan(0);

    // Verify no two warnings are closer together than the cooldown (2500ms).
    const flareEvents = result.warnings.filter((w) => w.type === 'elbow-flare');
    for (let i = 1; i < flareEvents.length; i++) {
      const gap = flareEvents[i].atMs - flareEvents[i - 1].atMs;
      expect(gap).toBeGreaterThanOrEqual(2500);
    }
  });

  it('Test B: fires torso-swing when torsoSwayX > 0.05 for 8+ consecutive frames during active rep', () => {
    // torsoSwayX=0.07 sustained for the entire dip phase — well past the 8-frame debounce.
    const frames = makeFrames((t) => {
      const flex = dipFlex(t);
      const torsoSwayX = flex > 20 ? 0.07 : 0;
      return { elbowFlexionDeg: flex, torsoSwayX, shoulderDescentY: dipShoulderDescent(flex) };
    }, 3);

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });

  it('Test B: momentary torso sway (5 frames, < debounce=8) does NOT trigger torso-swing', () => {
    // 5-frame spike during the dip — below the 8-frame debounce threshold.
    const frames = makeFrames((t) => {
      const flex = dipFlex(t);
      const torsoSwayX = t >= 600 && t <= 767 ? 0.07 : 0;
      return { elbowFlexionDeg: flex, torsoSwayX, shoulderDescentY: dipShoulderDescent(flex) };
    }, 2);

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('Test C (Fix A): elbow-flare frames during EXTENDED rest do NOT fire warning', () => {
    // The user holds elbowFlareX=0.07 (above the 0.06 detection threshold)
    // continuously, but the engine stays in EXTENDED (computed flex ≈ 24° < 30°
    // ASCEND_START). Fix A gate must suppress all firings during rest.
    // NOTE: elbowFlareX=0.07 is used instead of 0.09 because larger flare values
    // shift the elbow laterally relative to the shoulder, changing the computed
    // elbowFlexionDeg: at 0.09 the geometry produces ~30.4° which crosses
    // ASCEND_START_DEG=30 and enters DIPPING. At 0.07 the computed flex is ~24°.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        // Post-calibration: always EXTENDED (flex stays at 5) but with elbow flare.
        return {
          elbowFlexionDeg: 5,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          elbowFlareX: 0.07, // above 0.06 threshold but keeps computed flex < 30° (EXTENDED)
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });

  it('Test C (Fix A): torso-swing frames during EXTENDED rest do NOT fire warning', () => {
    // Same gating check for torso-swing: sustained torsoSwayX=0.07 while
    // arms remain extended (no dip). Zero warnings expected.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        return {
          elbowFlexionDeg: 5,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          torsoSwayX: 0.07, // past threshold, but state = EXTENDED → should be gated
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('DOES fire elbow-flare once user enters active dip phase with bad form', () => {
    // Contrast test: flare only during actual dip (flex > 30) should trigger warning.
    const repCycleMs = 2500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        const flex = dipFlex(tInRep);
        const inActive = flex > 30;
        return {
          elbowFlexionDeg: flex,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          elbowFlareX: inActive ? 0.09 : 0,
          shoulderDescentY: dipShoulderDescent(flex),
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'elbow-flare')).toBeGreaterThan(0);
  });
});
