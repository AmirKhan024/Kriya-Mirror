/**
 * Fire Hydrant — calibration tests.
 * Verifies: gate failures, instant confirm (~200ms), distance hints, timeout.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { Frame } from '../../harness/types';

// Valid calibration pose: body horizontal, hands below shoulders, good distance
function buildValidCalPose(overrides: {
  handsDown?: boolean;
  bodyHorizontal?: boolean;
  bodySpan?: number;
  visible?: boolean;
} = {}): PoseLandmarks {
  const { handsDown = true, bodyHorizontal = true, bodySpan = 0.55, visible = true } = overrides;
  const vis = visible ? 0.95 : 0.1;

  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.45;
  // When not horizontal, make the body tilted so |hip.y - shoulder.y| >> |hip.x - shoulder.x|
  const HIP_Y = bodyHorizontal ? 0.42 : SHOULDER_Y - 0.25; // tilted = hip much higher than shoulder
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;

  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;

  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis * 0.6 };

  // Ankle X is set to exactly (SHOULDER_X - bodySpan) so that
  // dx = |ankle.x - shoulder.x| = bodySpan, which is what the calibration checks.
  const ankleX = SHOULDER_X - bodySpan;
  const ankleY = HIP_Y + L_THIGH + L_SHIN * 0.3;
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: ankleX + 0.03, y: ankleY, z: 0, visibility: vis * 0.6 };

  const wristY = handsDown ? SHOULDER_Y + 0.32 : SHOULDER_Y - 0.10;
  lm[15] = { x: SHOULDER_X + 0.12, y: wristY, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: wristY, z: 0, visibility: vis * 0.7 };

  return lm;
}

function runCalTest(poseFn: (t: number) => PoseLandmarks | null, totalMs: number): {
  updates: CalibrationUpdate[];
  confirmedAtMs: number | null;
} {
  const updates: CalibrationUpdate[] = [];
  let confirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new FireHydrantEngine({
    onCalibrationUpdate: (u) => {
      updates.push(u);
      if (u.state === 'confirmed' && confirmedAtMs === null) {
        confirmedAtMs = currentTMs;
      }
    },
  });

  const fps = 30;
  const step = 1000 / fps;
  for (let t = 0; t <= totalMs; t += step) {
    currentTMs = t;
    engine.update(poseFn(t), t);
  }
  engine.finish();
  return { updates, confirmedAtMs };
}

describe('Fire Hydrant — calibration', () => {
  it('confirms quickly (~200ms) when all gates pass immediately', () => {
    const { confirmedAtMs } = runCalTest(
      () => buildValidCalPose(),
      1000,
    );
    expect(confirmedAtMs).not.toBeNull();
    expect(confirmedAtMs!).toBeLessThanOrEqual(600);
  });

  it('does not confirm when body is NOT horizontal (tilted up)', () => {
    const { confirmedAtMs } = runCalTest(
      () => buildValidCalPose({ bodyHorizontal: false }),
      3000,
    );
    expect(confirmedAtMs).toBeNull();
  });

  it('does not confirm when hands are raised above shoulders', () => {
    const { confirmedAtMs } = runCalTest(
      () => buildValidCalPose({ handsDown: false }),
      3000,
    );
    expect(confirmedAtMs).toBeNull();
  });

  it('does not confirm when landmarks are not visible', () => {
    const { confirmedAtMs } = runCalTest(
      () => buildValidCalPose({ visible: false }),
      3000,
    );
    expect(confirmedAtMs).toBeNull();
  });

  it('emits too-far distanceHint when body span is too small', () => {
    const { updates } = runCalTest(
      () => buildValidCalPose({ bodySpan: 0.30 }),
      2000,
    );
    const withHint = updates.filter((u) => u.distanceHint === 'too-far');
    expect(withHint.length).toBeGreaterThan(0);
  });

  it('emits too-close distanceHint when body span is too large', () => {
    const { updates } = runCalTest(
      () => buildValidCalPose({ bodySpan: 0.82 }),
      2000,
    );
    const withHint = updates.filter((u) => u.distanceHint === 'too-close');
    expect(withHint.length).toBeGreaterThan(0);
  });

  it('times out after 20s without confirming', () => {
    const { updates } = runCalTest(
      () => buildValidCalPose({ bodyHorizontal: false }),
      21000,
    );
    const timeouts = updates.filter((u) => u.state === 'timeout');
    expect(timeouts.length).toBeGreaterThan(0);
  });

  it('confirms after user moves into valid position', () => {
    // First 3s: bad pose (not horizontal). Then valid.
    const { confirmedAtMs } = runCalTest(
      (t) => t < 3000 ? buildValidCalPose({ bodyHorizontal: false }) : buildValidCalPose(),
      8000,
    );
    expect(confirmedAtMs).not.toBeNull();
    expect(confirmedAtMs!).toBeGreaterThan(3000);
  });
});
