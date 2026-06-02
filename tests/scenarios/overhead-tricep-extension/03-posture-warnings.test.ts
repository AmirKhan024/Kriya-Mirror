import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, countWarnings } from '../../harness/runner';
import type { Frame } from '../../harness/types';
import type { OTEPoseIntent } from '../../harness/types';

function calFrames(): Frame[] {
  return buildFrames(() => ({ extensionLevel: 1.0 }), buildOTEPose, { fps: 30, durationMs: 2200 });
}

function shiftFrames(frames: Frame[], byMs: number): Frame[] {
  return frames.map((f) => ({ tMs: f.tMs + byMs, landmarks: f.landmarks }));
}

function repWithFlare(elbowFlareX: number, durationMs: number): Frame[] {
  return buildFrames((t): OTEPoseIntent => {
    const ext = t < durationMs / 2 ? 1.0 - (t / (durationMs / 2)) : (t - durationMs / 2) / (durationMs / 2);
    return { extensionLevel: Math.max(0, Math.min(1, ext)), elbowFlareX };
  }, buildOTEPose, { fps: 30, durationMs });
}

function repWithSway(torsoSwayX: number, durationMs: number): Frame[] {
  return buildFrames((t): OTEPoseIntent => {
    const ext = t < durationMs / 2 ? 1.0 - (t / (durationMs / 2)) : (t - durationMs / 2) / (durationMs / 2);
    return { extensionLevel: Math.max(0, Math.min(1, ext)), torsoSwayX };
  }, buildOTEPose, { fps: 30, durationMs });
}

describe('Overhead Tricep Extension — posture warnings', () => {
  it('fires elbow-flare when elbows drift outward past threshold during the rep', () => {
    // elbowFlareX = 0.07 > ELBOW_FLARE_THRESHOLD 0.05, sustained for > 8 frames
    const repFrames = repWithFlare(0.07, 4000);
    const result = runOTESession([...calFrames(), ...shiftFrames(repFrames, 2200)]);
    expect(countWarnings(result, 'elbow-flare')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire elbow-flare when elbows stay within threshold', () => {
    const repFrames = repWithFlare(0.02, 4000);
    const result = runOTESession([...calFrames(), ...shiftFrames(repFrames, 2200)]);
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });

  it('fires torso-swing when shoulder midpoint drifts during the rep', () => {
    // torsoSwayX = 0.06 > TORSO_SWING_THRESHOLD 0.04
    const repFrames = repWithSway(0.06, 4000);
    const result = runOTESession([...calFrames(), ...shiftFrames(repFrames, 2200)]);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThanOrEqual(1);
  });

  it('brief elbow flare (< debounce frames) does NOT fire warning', () => {
    // Flare for ~3 frames (100ms at 30fps) — below ELBOW_FLARE_DEBOUNCE_FRAMES=8
    const frames = buildFrames((t): OTEPoseIntent => {
      const tPostCal = t - 2200;
      if (tPostCal < 0) return { extensionLevel: 1.0 };
      const flare = tPostCal >= 500 && tPostCal < 600 ? 0.08 : 0;
      const ext = tPostCal < 1500 ? 1.0 - (tPostCal / 1500) : Math.min(1, (tPostCal - 1500) / 1500);
      return { extensionLevel: Math.max(0, ext), elbowFlareX: flare };
    }, buildOTEPose, { fps: 30, durationMs: 2200 + 4000 });

    const result = runOTESession(frames);
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });
});
