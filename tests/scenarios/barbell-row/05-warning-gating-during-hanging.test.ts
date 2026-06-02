/**
 * 05-warning-gating-during-hanging — hip sway and rounded back injected while
 * repState === 'HANGING' must produce ZERO form warnings (Fix A).
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

describe('barbell-row 05-warning-gating-during-hanging', () => {
  it('rounded-back silenced while in HANGING state', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    // 50 frames all in HANGING with rounded back — engine is in HANGING throughout
    for (let i = 0; i < 50; i++, t += 33) {
      frames.push({
        landmarks: buildRowPose({
          elbowFlexionDeg: 10,    // ≤ HANGING_THRESHOLD_DEG (20)
          hipHingeDeg: 45,
          roundedBack: true,
        }),
        tMs: t,
      });
    }

    const result = runRowSession(frames);
    const backWarnings = result.warnings.filter((w) => w.type === 'rounded-back');
    expect(backWarnings).toHaveLength(0);
  });

  it('row-momentum silenced while in HANGING state', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    // 50 frames all in HANGING with extreme hip oscillation
    for (let i = 0; i < 50; i++, t += 33) {
      const swayY = (i % 3 === 0) ? 0.10 : (i % 3 === 1) ? -0.10 : 0;
      frames.push({
        landmarks: buildRowPose({
          elbowFlexionDeg: 10,
          hipHingeDeg: 45,
          hipSwayY: swayY,
        }),
        tMs: t,
      });
    }

    const result = runRowSession(frames);
    const momentumWarnings = result.warnings.filter((w) => w.type === 'row-momentum');
    expect(momentumWarnings).toHaveLength(0);
  });

  it('both form warnings silenced together in HANGING', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 500;

    for (let i = 0; i < 50; i++, t += 33) {
      const swayY = (i % 2 === 0) ? 0.08 : -0.08;
      frames.push({
        landmarks: buildRowPose({
          elbowFlexionDeg: 8,
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
