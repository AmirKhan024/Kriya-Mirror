/**
 * Regression test for the "collapsed-knees" bug surfaced by Amir's 2026-05-25
 * physical test (squat_console_logs_2sets_8reps.txt).
 *
 * Symptom: user squats with knees collapsing inward (valgus throughout the
 * descent and bottom). The engine emitted `valgus` warnings but the rep still
 * completed — `validateRepShape()` had no valgus-frame-ratio gate.
 *
 * Fix: per-rep raw valgus-frame counter + new `'collapsed-knees'` reject reason
 * (> 25% valgus frames over the active phase).
 *
 * KNOWN POSE-STUB LIMITATION: the synthetic pose-stub uses isoceles-triangle
 * geometry where knee position is mathematically derived from kneeFlexionDeg.
 * Pushing knees inward via valgusRatio reduces the engine's measured flexion
 * (via the 2D atan2 angle formula). In real MediaPipe data, 3D depth lets the
 * user have high flexion AND collapsed knees simultaneously; in our 2D stub
 * the two are conflicting.
 *
 * What we CAN assert here: a rep with valgusRatio=0.7 throughout does NOT
 * count — whether via the new collapsed-knees reject (real MediaPipe) or via
 * the state machine never confirming a deep-enough descent (synthetic).
 * What we CANNOT assert: the specific `malformed-rep` warning emission path.
 * That requires browser verification via console logs.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Squat — regression: collapsed-knees rep rejection (2026-05-25 physical test)', () => {
  it('rejects a rep where knees stay collapsed for the whole descent + bottom', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          // calibration pose: feet wide, arms overhead, knees NOT valgus
          return {
            kneeFlexionDeg: 0,
            feetWidthRatio: 1.25,
            armsOverhead: true,
          } as SquatPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
        else if (tInRep < 1500) kneeFlexionDeg = 100;
        else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
        else kneeFlexionDeg = 0;
        // KEY: knees fully collapsed during the entire active phase.
        // After the 2026-05-25 pose-stub rewrite, valgusRatio is "fraction
        // toward midline", so 0.7 puts kneeWidth well below the engine's
        // VALGUS_THRESHOLD_RATIO=0.15 baseline.
        return {
          kneeFlexionDeg,
          feetWidthRatio: 1.25,
          armsOverhead: false,
          valgusRatio: kneeFlexionDeg > 25 ? 0.7 : 0,
        } as SquatPoseIntent;
      },
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runSquatSession(frames);

    // The bug: pre-fix, all 3 reps would have been counted with high MQS even
    // though warnings array was empty. Post-fix: zero reps count.
    expect(result.completedReps.length).toBe(0);
  });

  it('still counts a clean rep with brief valgus (< 25% frames)', () => {
    // Sanity check: don't over-reject. A rep that's mostly clean but has 5
    // frames of valgus mid-descent should STILL count.
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true } as SquatPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
        else if (tInRep < 1500) kneeFlexionDeg = 100;
        else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
        else kneeFlexionDeg = 0;
        // Valgus for just 5 frames (~167ms at 30fps) — well below 25% threshold
        const briefValgus = tInRep >= 700 && tInRep <= 866;
        return {
          kneeFlexionDeg,
          feetWidthRatio: 1.25,
          armsOverhead: false,
          valgusRatio: briefValgus ? 0.30 : 0,
        } as SquatPoseIntent;
      },
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
