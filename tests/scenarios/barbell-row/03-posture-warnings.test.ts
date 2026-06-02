/**
 * 03-posture-warnings — hip sway fires row-momentum; rounded back fires rounded-back.
 * Both warnings are gated to active rep only (Fix A).
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

describe('barbell-row 03-posture-warnings', () => {
  it('hip sway during rowing fires row-momentum', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    // HANGING — no sway
    for (let i = 0; i < 10; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    // ROWING ramp with alternating large hip sway (exceeds ROW_MOMENTUM_HIP_VARIANCE=0.04)
    // hipSwayY alternates ±0.06, creating a variance of 0.12 >> 0.04
    for (let i = 0; i < 25; i++, t += 33) {
      const flex = 10 + ((150 - 10) * i) / 25;
      const swayY = (i % 2 === 0) ? 0.06 : -0.06;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45, hipSwayY: swayY }), tMs: t });
    }

    // AT_ROW_TOP hold with continued sway
    for (let i = 0; i < 30; i++, t += 33) {
      const swayY = (i % 2 === 0) ? 0.05 : -0.05;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 150, hipHingeDeg: 45, hipSwayY: swayY }), tMs: t });
    }

    // LOWERING back to hanging
    for (let i = 0; i < 15; i++, t += 33) {
      const flex = 150 - ((150 - 10) * i) / 15;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }

    // HANGING settle
    for (let i = 0; i < 8; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45 }), tMs: t });
    }

    const result = runRowSession(frames);
    const momentumWarnings = result.warnings.filter((w) => w.type === 'row-momentum');
    expect(momentumWarnings.length).toBeGreaterThan(0);
  });

  it('rounded back during rowing fires rounded-back', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    // HANGING — no rounded back
    for (let i = 0; i < 10; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
    }

    // ROWING ramp with rounded back
    for (let i = 0; i < 25; i++, t += 33) {
      const flex = 10 + ((150 - 10) * i) / 25;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45, roundedBack: true }), tMs: t });
    }

    // AT_ROW_TOP hold with rounded back (sustained → NO_FORM_OK_FRAMES=6 threshold crossed)
    for (let i = 0; i < 30; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 150, hipHingeDeg: 45, roundedBack: true }), tMs: t });
    }

    // LOWERING — stop rounded back mid-way
    for (let i = 0; i < 15; i++, t += 33) {
      const flex = 150 - ((150 - 10) * i) / 15;
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
    }

    // HANGING settle
    for (let i = 0; i < 8; i++, t += 33) {
      frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45 }), tMs: t });
    }

    const result = runRowSession(frames);
    const backWarnings = result.warnings.filter((w) => w.type === 'rounded-back');
    expect(backWarnings.length).toBeGreaterThan(0);
  });

  it('form warnings gated to active rep — NOT fired in HANGING', () => {
    // Inject sway and rounded back only while in HANGING state — should produce NO form warnings
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    // 40 frames all in HANGING with extreme bad form injected
    for (let i = 0; i < 40; i++, t += 33) {
      const swayY = (i % 2 === 0) ? 0.08 : -0.08;
      frames.push({
        landmarks: buildRowPose({
          elbowFlexionDeg: 10,   // ≤ HANGING_THRESHOLD_DEG → stays HANGING
          hipHingeDeg: 45,
          roundedBack: true,
          hipSwayY: swayY,
        }),
        tMs: t,
      });
    }

    const result = runRowSession(frames);
    const formWarnings = result.warnings.filter((w) =>
      w.type === 'rounded-back' || w.type === 'row-momentum',
    );
    expect(formWarnings).toHaveLength(0);
  });
});
