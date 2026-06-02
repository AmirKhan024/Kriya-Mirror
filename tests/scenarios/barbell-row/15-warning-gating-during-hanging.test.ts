/**
 * 15-warning-gating-during-hanging — form warnings silent during HANGING state.
 * Mirrors 05 but tests deeper scenarios including transition from rep back to HANGING.
 */
import { describe, it, expect } from 'vitest';
import { runRowSession } from '../../harness/runner';
import { buildRowPose } from '../../harness/pose-stub';
import type { Frame } from '../../harness/types';

function calFrames(): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t <= 500; t += 33) {
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
  }
  return frames;
}

describe('barbell-row 15-warning-gating-during-hanging', () => {
  it('form warnings fired during ROWING but silenced after returning to HANGING', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    // HANGING with rounded back — should be silenced
    for (let i = 0; i < 10; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45, roundedBack: true }), tMs: t });
    }

    // ROWING ramp with rounded back — warnings ALLOWED here (active rep)
    for (let i = 0; i < 25; i++, t += 33) {
      const flex = 10 + ((150 - 10) * i) / 25;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45, roundedBack: true }), tMs: t });
    }

    // AT_ROW_TOP with rounded back (sustained 30 frames → triggers warning)
    for (let i = 0; i < 30; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 150, hipHingeDeg: 45, roundedBack: true }), tMs: t });
    }

    // LOWERING — good form now
    for (let i = 0; i < 15; i++, t += 33) {
      const flex = 150 - ((150 - 10) * i) / 15;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }

    // Back to HANGING — rounded back injected again but NOW gated
    const hangingStartAt = t;
    for (let i = 0; i < 30; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45, roundedBack: true }), tMs: t });
    }

    const result = runRowSession(frames);
    const backWarnings = result.warnings.filter((w) => w.type === 'rounded-back');

    // Warnings must have fired during the active rep phase (ROWING / AT_ROW_TOP)
    expect(backWarnings.length).toBeGreaterThan(0);

    // No new warnings should fire more than 3s after returning to HANGING
    const afterHanging = backWarnings.filter((w) => w.atMs > hangingStartAt + 3000);
    expect(afterHanging).toHaveLength(0);
  });

  it('row-momentum gated: no warnings for hip sway during HANGING only', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    // Only HANGING frames (elbowFlexionDeg=8 < HANGING_THRESHOLD=20) with hip sway
    for (let i = 0; i < 60; i++, t += 33) {
      const swayY = Math.sin(i * 0.5) * 0.1;
      frames.push({
        landmarks: buildRowPose({ elbowFlexionDeg: 8, hipHingeDeg: 45, hipSwayY: swayY }),
        tMs: t,
      });
    }

    const result = runRowSession(frames);
    const momentumWarnings = result.warnings.filter((w) => w.type === 'row-momentum');
    expect(momentumWarnings).toHaveLength(0);
  });
});
