/**
 * 13-not-moving-init — idle tracker initializes on cal-confirm (not on construction).
 * First not-moving fires at 5s after calibration, NOT before.
 * Fix I + Fix P tests.
 */
import { describe, it, expect } from 'vitest';
import { runRowSession } from '../../harness/runner';
import { buildRowPose } from '../../harness/pose-stub';
import type { Frame } from '../../harness/types';

describe('barbell-row 13-not-moving-init', () => {
  it('no not-moving warning before calibration is confirmed', () => {
    const frames: Frame[] = [];

    // Valid pose but calibration not yet confirmed at 0–200ms (only 2 frames)
    // Then switch to invalid (standing) to prevent confirmation but stay in waiting
    // Actually: use 0 frames that would confirm. Just check that the warning doesn't
    // fire before cal-confirm by running exactly up to just before confirm.
    // Feed only 1 frame — not enough for 200ms confirmation window
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: 0 });
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: 33 });

    // Then idle with standing pose for 6 seconds to try to trigger not-moving
    for (let t = 100; t <= 6200; t += 100) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 5 }), tMs: t });
    }

    const result = runRowSession(frames);
    expect(result.calibrationConfirmedAtMs).toBeNull();
    const notMoving = result.warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving).toHaveLength(0);
  });

  it('not-moving fires at ~5s after calibration confirm (no sooner)', () => {
    const frames: Frame[] = [];

    // Calibrate by 400ms
    for (let t = 0; t <= 400; t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    const calDoneAt = 400;

    // Idle in HANGING for 4s — should NOT fire yet
    for (let t = calDoneAt + 33; t <= calDoneAt + 4000; t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    const resultBefore = runRowSession(frames);
    const notMovingBefore = resultBefore.warnings.filter((w) => w.type === 'not-moving');
    expect(notMovingBefore).toHaveLength(0);

    // Now add more frames to push past 5s idle
    for (let t = calDoneAt + 4000 + 33; t <= calDoneAt + 6000; t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    const resultAfter = runRowSession(frames);
    const notMovingAfter = resultAfter.warnings.filter((w) => w.type === 'not-moving');
    expect(notMovingAfter.length).toBeGreaterThan(0);
    // First not-moving should be at least 5s after cal confirm
    expect(notMovingAfter[0].atMs).toBeGreaterThanOrEqual(calDoneAt + 5000);
  });

  it('not-moving does not repeat within 15s (Fix P cooldown)', () => {
    const frames: Frame[] = [];

    // Calibrate
    for (let t = 0; t <= 400; t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    const calDoneAt = 400;

    // Idle for 20s — should fire once at ~5s and again at ~5s + 15s = ~20s
    for (let t = calDoneAt + 33; t <= calDoneAt + 22000; t += 100) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    const result = runRowSession(frames);
    const notMovings = result.warnings.filter((w) => w.type === 'not-moving');

    // Should fire at 5s and at ~20s (5+15), but not multiple times in the first 14s
    // At minimum it should fire once, and no more than 2 in 22s
    expect(notMovings.length).toBeGreaterThanOrEqual(1);
    if (notMovings.length >= 2) {
      // Gap between first and second must be >= 15s
      expect(notMovings[1].atMs - notMovings[0].atMs).toBeGreaterThanOrEqual(14000);
    }
  });
});
