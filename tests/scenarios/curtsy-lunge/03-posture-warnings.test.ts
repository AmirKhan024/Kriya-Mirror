/**
 * Posture warnings tests:
 * 1. Hip rotation → emits 'hip-rotation-curtsy'
 * 2. Trunk lean → emits 'trunk-lean'
 * 3. Knee valgus → emits 'knee-valgus'
 * 4. Warning debounce: 1-frame valgus does NOT trigger; 10-frame sustained does
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, countWarnings } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_CYCLE_MS = 3500;

describe('Curtsy Lunge — posture warnings', () => {
  it('emits hip-rotation-curtsy when rear hip rises > 12% torsoHeight during descent', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1200) kneeFlexionDeg = 170 - (tInRep / 1200) * 80;
        else if (tInRep < 1700) kneeFlexionDeg = 90;
        else if (tInRep < 2900) kneeFlexionDeg = 90 + ((tInRep - 1700) / 1200) * 80;
        else kneeFlexionDeg = 170;
        const inRep = tInRep < 2900;
        return {
          kneeFlexionDeg,
          crossoverRatio: inRep ? 0.12 : 0,
          hipRotation: inRep ? 0.15 : 0, // > 12% threshold → triggers hip-rotation-curtsy
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-rotation-curtsy' as any)).toBeGreaterThan(0);
  });

  it('emits trunk-lean when torso angle > 45° from vertical during rep', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1200) kneeFlexionDeg = 170 - (tInRep / 1200) * 80;
        else if (tInRep < 1700) kneeFlexionDeg = 90;
        else if (tInRep < 2900) kneeFlexionDeg = 90 + ((tInRep - 1700) / 1200) * 80;
        else kneeFlexionDeg = 170;
        const inRep = tInRep < 2900;
        return {
          kneeFlexionDeg,
          crossoverRatio: inRep ? 0.12 : 0,
          trunkLeanDeg: inRep ? 50 : 0, // > 45° threshold → triggers trunk-lean
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'trunk-lean' as any)).toBeGreaterThan(0);
  });

  it('emits knee-valgus when front knee caves inward during rep', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1200) kneeFlexionDeg = 170 - (tInRep / 1200) * 80;
        else if (tInRep < 1700) kneeFlexionDeg = 90;
        else if (tInRep < 2900) kneeFlexionDeg = 90 + ((tInRep - 1700) / 1200) * 80;
        else kneeFlexionDeg = 170;
        const inRep = tInRep < 2900;
        return {
          kneeFlexionDeg,
          crossoverRatio: inRep ? 0.12 : 0,
          kneeValgusRatio: inRep ? 0.25 : 0, // > 0.18 threshold for 10+ frames
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-valgus' as any)).toBeGreaterThan(0);
  });

  it('does NOT emit knee-valgus for a single-frame spike (debounce = 10 frames)', () => {
    let frameIndex = 0;
    const frames = buildFrames(
      (tMs) => {
        frameIndex++;
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1200) kneeFlexionDeg = 170 - (tInRep / 1200) * 80;
        else if (tInRep < 1700) kneeFlexionDeg = 90;
        else if (tInRep < 2900) kneeFlexionDeg = 90 + ((tInRep - 1700) / 1200) * 80;
        else kneeFlexionDeg = 170;
        const inRep = tInRep < 2900;
        // Only a single frame of valgus at bottom of rep
        const isValgusFrame = tInRep >= 1200 && tInRep <= 1233; // ~1 frame at 30fps
        return {
          kneeFlexionDeg,
          crossoverRatio: inRep ? 0.12 : 0,
          kneeValgusRatio: isValgusFrame ? 0.25 : 0,
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    // A single-frame spike should NOT trigger valgus (debounce = 10 frames)
    expect(countWarnings(result, 'knee-valgus' as any)).toBe(0);
  });
});
