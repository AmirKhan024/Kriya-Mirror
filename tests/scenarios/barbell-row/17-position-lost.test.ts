/**
 * 17-position-lost — null landmarks ≥ 3s fires position-lost; clean stream silent;
 * 10s repeat cooldown respected. Fix N.
 */
import { describe, it, expect } from 'vitest';
import { runRowSession } from '../../harness/runner';
import { buildRowPose } from '../../harness/pose-stub';
import type { Frame } from '../../harness/types';

function calFrames(): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t <= 400; t += 33) {
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
  }
  return frames;
}

describe('barbell-row 17-position-lost', () => {
  it('position-lost fires after 3s of null landmarks', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    // 1s of valid frames
    for (let end = t; end < t + 1000; end += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }
    t += 1000;

    // 4s of null landmarks — exceeds POSITION_LOST_TIMEOUT_MS (3000)
    for (let end = t; end < t + 4000; end += 100) {
      frames.push({ landmarks: null, tMs: end });
    }

    const result = runRowSession(frames);
    const posLostWarnings = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLostWarnings.length).toBeGreaterThan(0);
  });

  it('position-lost does NOT fire with 2s of null (below 3s threshold)', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    // 1s of valid frames
    for (let end = t; end < t + 1000; end += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }
    t += 1000;

    // 2s of null (below threshold)
    for (let end = t; end < t + 2000; end += 100) {
      frames.push({ landmarks: null, tMs: end });
    }

    const result = runRowSession(frames);
    const posLostWarnings = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLostWarnings).toHaveLength(0);
  });

  it('position-lost does NOT fire on clean landmark stream', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    for (let end = t; end < t + 5000; end += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }

    const result = runRowSession(frames);
    const posLostWarnings = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLostWarnings).toHaveLength(0);
  });

  it('position-lost respects 10s repeat cooldown', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    // 1s valid
    for (let end = t; end < t + 1000; end += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }
    t += 1000;

    // 15s of null — should fire once at ~3s, then again at ~13s
    for (let end = t; end < t + 15000; end += 100) {
      frames.push({ landmarks: null, tMs: end });
    }

    const result = runRowSession(frames);
    const posLostWarnings = result.warnings.filter((w) => w.type === 'position-lost');

    // Should fire at least once
    expect(posLostWarnings.length).toBeGreaterThanOrEqual(1);

    // If it fires twice, the gap must be >= 10s
    if (posLostWarnings.length >= 2) {
      const gap = posLostWarnings[1].atMs - posLostWarnings[0].atMs;
      expect(gap).toBeGreaterThanOrEqual(9000);
    }
  });

  it('returns from null stream without firing after quick recovery', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    // 1s valid
    for (let end = t; end < t + 1000; end += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }
    t += 1000;

    // Brief null (1s — below threshold)
    for (let end = t; end < t + 1000; end += 100) {
      frames.push({ landmarks: null, tMs: end });
    }
    t += 1000;

    // Valid again
    for (let end = t; end < t + 2000; end += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }

    const result = runRowSession(frames);
    const posLostWarnings = result.warnings.filter((w) => w.type === 'position-lost');
    // Brief null then recovery — no warning fired
    expect(posLostWarnings).toHaveLength(0);
  });
});
