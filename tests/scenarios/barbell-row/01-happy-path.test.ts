/**
 * 01-happy-path — 5 clean rows count correctly.
 *
 * The user calibrates in bent-over working position, then performs 5 reps:
 *   HANGING → ROWING → AT_ROW_TOP → LOWERING → HANGING
 *
 * Throughout all reps, the hip hinge stays constant (no torso oscillation,
 * no rounded back). All 5 reps should be counted.
 *
 * NOTE: EMA_ALPHA_ELBOW = 0.15 means the smoothed elbow flex lags raw values
 * significantly. Rep design must account for this:
 *   - Long ramp (25 frames) so EMA crosses ROW_START_DEG (30°) during ascent
 *   - Long hold (30 frames) so EMA settles to produce 6 stable frames
 *   - Standard lower (15 frames) sufficient to cross HANGING threshold
 */
import { describe, it, expect } from 'vitest';
import { runRowSession } from '../../harness/runner';
import { buildRowPose } from '../../harness/pose-stub';
import type { Frame } from '../../harness/types';

/** Calibration: 500ms of valid bent-over pose at arms-hanging elbow position. */
function calFrames(): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t <= 500; t += 33) {
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
  }
  return frames;
}

/**
 * Build one complete row rep designed for EMA_ALPHA=0.15 smoothing.
 * Total rep: ~85 frames @ 33ms = ~2.8s.
 */
function oneRep(startMs: number): Frame[] {
  const frames: Frame[] = [];
  let t = startMs;

  // HANGING: arms down, 10 frames to ensure we're solidly in HANGING
  for (let i = 0; i < 10; i++, t += 33) {
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 10, hipHingeDeg: 45 }), tMs: t });
  }

  // ROWING ramp: 25 frames from 10 → 150 targetFlex.
  // computed flex goes from ~8.5° to ~104°.
  // EMA crosses ROW_START_DEG (~30°) around frame 9 of ramp.
  for (let i = 0; i < 25; i++, t += 33) {
    const flex = 10 + ((150 - 10) * i) / 25;
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
  }

  // AT_ROW_TOP hold: 30 frames at 150 targetFlex (computed ~104°).
  // EMA settles to ~104° → delta drops below ROW_TOP_STABILITY_DELTA (3°) → 6+ stable frames.
  for (let i = 0; i < 30; i++, t += 33) {
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 150, hipHingeDeg: 45 }), tMs: t });
  }

  // LOWERING: 15 frames from 150 → 10 targetFlex.
  // When raw drops from ~104 to ~8.5, the first EMA delta is large and negative → LOWERING.
  // EMA will cross HANGING_THRESHOLD (20°) before the end.
  for (let i = 0; i < 15; i++, t += 33) {
    const flex = 150 - ((150 - 10) * i) / 15;
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: flex, hipHingeDeg: 45 }), tMs: t });
  }

  // HANGING settle: 8 frames at arms-down position for rep to complete
  for (let i = 0; i < 8; i++, t += 33) {
    frames.push({ landmarks: buildRowPose({ elbowFlexionDeg: 5, hipHingeDeg: 45 }), tMs: t });
  }

  return frames;
}

describe('barbell-row 01-happy-path', () => {
  it('counts 5 clean rows', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    for (let r = 0; r < 5; r++) {
      const rep = oneRep(t);
      frames.push(...rep);
      t = rep[rep.length - 1].tMs + 50;
    }

    const result = runRowSession(frames);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.completedReps).toHaveLength(5);
  });

  it('emits no form warnings on clean reps', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    for (let r = 0; r < 5; r++) {
      const rep = oneRep(t);
      frames.push(...rep);
      t = rep[rep.length - 1].tMs + 50;
    }

    const result = runRowSession(frames);
    const formWarnings = result.warnings.filter((w) =>
      w.type === 'rounded-back' || w.type === 'row-momentum',
    );
    expect(formWarnings).toHaveLength(0);
  });

  it('each rep has mqs > 0 and depthDeg > 0', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    for (let r = 0; r < 5; r++) {
      const rep = oneRep(t);
      frames.push(...rep);
      t = rep[rep.length - 1].tMs + 50;
    }

    const result = runRowSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
      expect(rep.depthDeg).toBeGreaterThan(0);
    }
  });

  it('hip hinge stays constant — no torso-swing warnings', () => {
    const frames: Frame[] = [...calFrames()];
    let t = 600;

    for (let r = 0; r < 5; r++) {
      const rep = oneRep(t);
      frames.push(...rep);
      t = rep[rep.length - 1].tMs + 50;
    }

    const result = runRowSession(frames);
    const momentumWarnings = result.warnings.filter((w) => w.type === 'row-momentum');
    expect(momentumWarnings).toHaveLength(0);
  });
});
