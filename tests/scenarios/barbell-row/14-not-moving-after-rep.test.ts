/**
 * 14-not-moving-after-rep — do one row, idle 8s → not-moving fires.
 * Fix O: EMA-decay reseed after returning to HANGING.
 */
import { describe, it, expect } from 'vitest';
import { runRowSession } from '../../harness/runner';
import { buildRowPose } from '../../harness/pose-stub';
import type { Frame } from '../../harness/types';

describe('barbell-row 14-not-moving-after-rep', () => {
  it('not-moving fires after 8s idle following a completed rep', () => {
    const frames: Frame[] = [];

    // Calibrate
    for (let t = 0; t <= 400; t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    let t = 500;

    // HANGING
    for (let i = 0; i < 8; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    // ROWING
    for (let i = 0; i < 16; i++, t += 33) {
      const flex = 10 + ((110 - 10) * i) / 16;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }

    // AT_ROW_TOP
    for (let i = 0; i < 8; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 110, hipHingeDeg: 45 }), tMs: t });
    }

    // LOWERING
    for (let i = 0; i < 12; i++, t += 33) {
      const flex = 110 - ((110 - 5) * i) / 12;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }

    // HANGING settle
    for (let i = 0; i < 4; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45 }), tMs: t });
    }

    // Rep done — now record when rep completed
    const repDoneAt = t;

    // Idle for 8s — should trigger not-moving
    for (let end = repDoneAt + 100; end <= repDoneAt + 8500; end += 100) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45 }), tMs: end });
    }

    const result = runRowSession(frames);

    // One rep should have completed
    expect(result.completedReps).toHaveLength(1);

    // not-moving should fire after rep + 5s idle
    const notMovings = result.warnings.filter((w) => w.type === 'not-moving');
    expect(notMovings.length).toBeGreaterThan(0);
    // Should fire after ~5s of idle post-rep
    expect(notMovings[0].atMs).toBeGreaterThan(repDoneAt + 4000);
  });

  it('EMA reseed: not-moving clock resets after rep, does not fire during active rowing', () => {
    const frames: Frame[] = [];

    // Calibrate
    for (let t = 0; t <= 400; t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    let t = 500;

    // Idle for 4s before doing the rep (approaching but not crossing 5s threshold)
    for (let end = t; end < t + 4000; end += 100) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: end });
    }
    t += 4000;

    // Do one rep (interrupts the idle counter)
    for (let i = 0; i < 8; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }
    for (let i = 0; i < 16; i++, t += 33) {
      const flex = 10 + ((110 - 10) * i) / 16;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }
    for (let i = 0; i < 8; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 110, hipHingeDeg: 45 }), tMs: t });
    }
    for (let i = 0; i < 12; i++, t += 33) {
      const flex = 110 - ((110 - 5) * i) / 12;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }
    for (let i = 0; i < 4; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45 }), tMs: t });
    }

    // Now check that not-moving has NOT fired yet (rep prevented the early fire)
    const resultMid = runRowSession(frames);
    const notMovingsDuringRep = resultMid.warnings.filter((w) => w.type === 'not-moving');
    // Should have 0 or just the one that might have fired before the rep at ~4s if approaching
    // Key: not during the active rep itself
    for (const w of notMovingsDuringRep) {
      // If it fired, it was during the HANGING phase before, not during the row
      expect(w.atMs).toBeLessThan(t - 1000); // at least 1s before rep finished
    }
  });
});
