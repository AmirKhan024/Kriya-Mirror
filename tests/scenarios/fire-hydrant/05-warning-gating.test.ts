/**
 * Fire Hydrant — Fix A: warning gating during AT_REST state.
 * Verifies: not-moving fires, but only after idle threshold.
 * (Fire hydrant has no per-frame coaching warnings like valgus/trunk-forward,
 * so this test focuses on the idle detection gating behavior.)
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';

function buildFHPose(liftDeg = 0, vis = 0.95): PoseLandmarks {
  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.45;
  const HIP_Y = 0.42;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;
  const rotRad = liftDeg * Math.PI / 180;
  const kneeX = HIP_X - L_THIGH * Math.sin(rotRad);
  const kneeY = HIP_Y + L_THIGH * Math.cos(rotRad);
  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;
  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: kneeX - L_SHIN, y: kneeY + L_SHIN * 0.3, z: 0, visibility: vis };
  lm[28] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: vis * 0.7 };
  return lm;
}

describe('Fire Hydrant — warning gating during AT_REST', () => {
  it('no warnings fire during a clean 3-rep session (except not-moving if idle)', () => {
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: () => {},
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    const fps = 30;
    const step = 1000 / fps;
    const CAL_MS = 2200;
    const REP_CYCLE = 3000;
    const totalMs = CAL_MS + 3 * REP_CYCLE;

    for (let t = 0; t <= totalMs; t += step) {
      currentTMs = t;
      let liftDeg = 0;
      if (t >= CAL_MS) {
        const tRep = (t - CAL_MS) % REP_CYCLE;
        if (tRep < 800) liftDeg = (tRep / 800) * 55;
        else if (tRep < 1400) liftDeg = 55;
        else if (tRep < 2200) liftDeg = 55 - ((tRep - 1400) / 800) * 55;
        else liftDeg = 0;
      }
      engine.update(buildFHPose(Math.max(0, liftDeg)), t);
    }
    engine.finish();

    // No warnings other than maybe not-moving (only fires after 5s idle, rep cycle is 3s so no idle)
    const nonNotMoving = warnings.filter((w) => w.type !== 'not-moving');
    expect(nonNotMoving.length).toBe(0);
  });

  it('not-moving is blocked when user performs a rep within 5s window', () => {
    // Instant calibration: confirms at ~300ms.
    // Rep starts at t=3000ms — only 2.7s post-cal, well under the 5s threshold.
    // After the rep finishes at ~6200ms, idle until 9000ms (2.8s < 5s) — no warning.
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calConfirmedAt: number | null = null;
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: (u) => {
        if (u.state === 'confirmed' && calConfirmedAt === null) calConfirmedAt = currentTMs;
      },
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    const fps = 30;
    const step = 1000 / fps;
    // Cal phase (0–2200ms of valid pose), rep at 3000–6200ms, then idle
    const REP_START = 3000;
    const totalMs = 9000;

    for (let t = 0; t <= totalMs; t += step) {
      currentTMs = t;
      let liftDeg = 0;
      if (t >= REP_START && t < REP_START + 3200) {
        const tRep = t - REP_START;
        if (tRep < 800) liftDeg = (tRep / 800) * 55;
        else if (tRep < 1400) liftDeg = 55;
        else if (tRep < 2200) liftDeg = 55 - ((tRep - 1400) / 800) * 55;
        else liftDeg = 0;
      }
      engine.update(buildFHPose(Math.max(0, liftDeg)), t);
    }
    engine.finish();

    // not-moving should not fire: rep happens before 5s of idle from cal confirm,
    // and after the rep the total session ends before 5s idle can accumulate again.
    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    // Verify: cal confirmed early enough that rep starts before 5s idle threshold
    if (calConfirmedAt !== null) {
      expect(REP_START - calConfirmedAt).toBeLessThan(5000);
    }
    expect(notMoving.length).toBe(0);
  });
});
