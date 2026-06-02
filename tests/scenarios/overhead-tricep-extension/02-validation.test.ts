import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, countWarnings } from '../../harness/runner';

function calFrames() {
  return buildFrames(() => ({ extensionLevel: 1.0 }), buildOTEPose, { fps: 30, durationMs: 2200 });
}

describe('Overhead Tricep Extension — validation', () => {
  it('rejects a shallow rep (extensionLevel stays above 0.60) as incomplete-tricep-extension', () => {
    // extensionLevel goes from 1.0 → 0.60 (extDeg ≈ 54° > MIN_REP_DEPTH_EXT_DEG 40°)
    // The EMA-smoothed value will track near 54° — well above the 40° threshold.
    const repFrames = buildFrames((t) => {
      if (t < 1000) return { extensionLevel: 1.0 - (t / 1000) * 0.40 }; // 1.0 → 0.60
      if (t < 1500) return { extensionLevel: 0.60 };
      if (t < 2500) return { extensionLevel: 0.60 + ((t - 1500) / 1000) * 0.40 };
      return { extensionLevel: 1.0 };
    }, buildOTEPose, { fps: 30, durationMs: 3000 });

    const result = runOTESession([...calFrames(), ...repFrames.map((f) => ({ ...f, tMs: f.tMs + 2200 }))]);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-tricep-extension')).toBeGreaterThanOrEqual(1);
  });

  it('rejects a very shallow rep (ext never drops below 0.70) and fires incomplete warning', () => {
    // extensionLevel only drops to 0.70 (extDeg ≈ 63° > MIN_REP_DEPTH_EXT_DEG 40°)
    const repFrames = buildFrames((t) => {
      if (t < 1000) return { extensionLevel: 1.0 - (t / 1000) * 0.30 }; // 1.0 → 0.70
      if (t < 2000) return { extensionLevel: 0.70 };
      if (t < 3000) return { extensionLevel: 0.70 + ((t - 2000) / 1000) * 0.30 };
      return { extensionLevel: 1.0 };
    }, buildOTEPose, { fps: 30, durationMs: 4000 });

    const result = runOTESession([...calFrames(), ...repFrames.map((f) => ({ ...f, tMs: f.tMs + 2200 }))]);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-tricep-extension')).toBeGreaterThanOrEqual(1);
  });

  it('rejects a unilateral rep (one arm stays near extended) as malformed-rep', () => {
    // Left arm lowers fully (ext=0.0), right arm stays mostly extended (ext=0.85)
    // leftDepth = 90, rightDepth ≈ 13.5 → ratio ≈ 0.15 < MIN_BILATERAL_SYMMETRY
    const repFrames = buildFrames((t) => {
      if (t < 1000) return { extensionLevel: 1.0, leftExtensionLevel: 1.0 - (t / 1000), rightExtensionLevel: 1.0 - (t / 1000) * 0.15 };
      if (t < 1500) return { extensionLevel: 0.0, leftExtensionLevel: 0.0, rightExtensionLevel: 0.85 };
      if (t < 2500) return { extensionLevel: 1.0, leftExtensionLevel: Math.min(1.0, t / 2500), rightExtensionLevel: Math.min(1.0, 0.85 + (t - 1500) / 10000) };
      return { extensionLevel: 1.0 };
    }, buildOTEPose, { fps: 30, durationMs: 3000 });

    const result = runOTESession([...calFrames(), ...repFrames.map((f) => ({ ...f, tMs: f.tMs + 2200 }))]);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThanOrEqual(1);
  });

  it('counts a good rep that reaches deep bottom position', () => {
    // extensionLevel drops to 0.10 → extDeg ≈ 9° << MIN_REP_DEPTH_EXT_DEG 40°.
    // EMA will settle well below 40° during the hold.
    const repFrames = buildFrames((t) => {
      if (t < 1000) return { extensionLevel: 1.0 - (t / 1000) * 0.90 }; // 1.0 → 0.10
      if (t < 2000) return { extensionLevel: 0.10 };
      if (t < 3000) return { extensionLevel: 0.10 + ((t - 2000) / 1000) * 0.90 };
      return { extensionLevel: 1.0 };
    }, buildOTEPose, { fps: 30, durationMs: 3500 });

    const result = runOTESession([...calFrames(), ...repFrames.map((f) => ({ ...f, tMs: f.tMs + 2200 }))]);

    expect(result.completedReps.length).toBe(1);
  });
});
