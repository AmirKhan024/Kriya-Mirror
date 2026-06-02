/**
 * Fire Hydrant — Fix O: not-moving fires after rep + idle (EMA-decay reseed).
 *
 * Bug: after a rep completes, smoothedThighLiftDeg decays from ~17° → 0° over
 * several seconds. This EMA decay permanently inflates max-min variance above 2°,
 * so the idle gate never fires — not-moving never warns after a real rep.
 *
 * Fix O reseeds the min/max once the EMA has settled (< 0.3° change for 500ms).
 * This test catches regression: do a rep, idle for 8s, assert not-moving fires.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { WarningType } from '@/store/workout';

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

describe('Fire Hydrant — not-moving after rep (Fix O)', () => {
  it('fires not-moving after one rep + 8s idle (EMA reseed works)', () => {
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let completedReps = 0;
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: (_u: CalibrationUpdate) => {},
      onRepComplete: () => { completedReps++; },
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    const fps = 30;
    const step = 1000 / fps;
    const CAL_MS = 2200;
    const REP_MS = 3000; // one complete 3s rep cycle
    const IDLE_MS = 8000; // 8s idle after the rep
    const totalMs = CAL_MS + REP_MS + IDLE_MS;

    for (let t = 0; t <= totalMs; t += step) {
      currentTMs = t;
      let liftDeg = 0;
      if (t >= CAL_MS && t < CAL_MS + REP_MS) {
        const tRep = t - CAL_MS;
        if (tRep < 800) liftDeg = (tRep / 800) * 55;
        else if (tRep < 1400) liftDeg = 55;
        else if (tRep < 2200) liftDeg = 55 - ((tRep - 1400) / 800) * 55;
        else liftDeg = 0;
      }
      engine.update(buildFHPose(Math.max(0, liftDeg)), t);
    }
    engine.finish();

    // Must have completed at least 1 rep
    expect(completedReps).toBeGreaterThanOrEqual(1);
    // not-moving must have fired during the 8s idle period post-rep
    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBeGreaterThanOrEqual(1);
    // Ensure it fired after the rep ended (after CAL_MS + REP_MS)
    expect(notMoving[0].atMs).toBeGreaterThan(CAL_MS + REP_MS);
  });
});
