/**
 * Engine runner — drives a real SquatEngine / PlankEngine through a frame
 * stream and captures every event emitted (calibration updates, reps,
 * warnings, frame metrics, hold ticks). Pure Node — no DOM needed.
 */
import { SquatEngine } from '@/modules/squat/engine';
import { PlankEngine } from '@/modules/plank/engine';
import { PushupEngine } from '@/modules/pushup/engine';
import { LungeEngine } from '@/modules/lunge/engine';
import { TandemStandEngine } from '@/modules/tandem-stand/engine';
import { BicepCurlEngine } from '@/modules/bicep-curl/engine';
import { SingleLegStandEngine } from '@/modules/single-leg-stand/engine';
import { StarPoseEngine } from '@/modules/star-pose/engine';
import { StandingFigure4Engine } from '@/modules/standing-figure-4/engine';
import { GatePoseEngine } from '@/modules/gate-pose/engine';
import { ChairPoseEngine } from '@/modules/chair-pose/engine';
import { LateralRaiseEngine } from '@/modules/lateral-raise/engine';
import { TreePoseEngine } from '@/modules/tree-pose/engine';
import { WarriorTwoEngine } from '@/modules/warrior-2/engine';
import { WarriorOneEngine } from '@/modules/warrior-1/engine';
import { WarriorThreeEngine } from '@/modules/warrior-3/engine';
import { SidePlankEngine } from '@/modules/side-plank/engine';
import { BoatPoseEngine } from '@/modules/boat-pose/engine';
import { MountainPoseEngine } from '@/modules/mountain-pose/engine';
import { CalfRaiseEngine } from '@/modules/calf-raise/engine';
import { JumpingJacksEngine } from '@/modules/jumping-jacks/engine';
import { HighKneesEngine } from '@/modules/high-knees/engine';
import { FrontRaiseEngine } from '@/modules/front-raise/engine';
import { ArmCirclesEngine } from '@/modules/arm-circles/engine';
import { GoddessPoseEngine } from '@/modules/goddess-pose/engine';
import { TrianglePoseEngine } from '@/modules/triangle-pose/engine';
import { WallSitEngine } from '@/modules/wall-sit/engine';
import { SideLegRaiseEngine } from '@/modules/side-leg-raise/engine';
import { StandingLegSwingEngine } from '@/modules/standing-leg-swing/engine';
import { CatCowEngine } from '@/modules/cat-cow/engine';
import { SideBendEngine } from '@/modules/oblique-side-bend/engine';
import { ReverseLungeEngine } from '@/modules/reverse-lunge/engine';
import { LateralLungeEngine } from '@/modules/lateral-lunge/engine';
import { CossackSquatEngine } from '@/modules/cossack-squat/engine';
import { SitToStandEngine } from '@/modules/sit-to-stand/engine';
import { StandingForwardFoldEngine } from '@/modules/standing-forward-fold/engine';
import { DownwardDogEngine } from '@/modules/downward-dog/engine';
import { CobraPoseEngine } from '@/modules/cobra-pose/engine';
import { SeatedMarchEngine } from '@/modules/seated-march/engine';
import { SeatedForwardFoldEngine } from '@/modules/seated-forward-fold/engine';
// Strength exercises (ported from Bilal's harness)
import { ConventionalDeadliftEngine } from '@/modules/conventional-deadlift/engine';
import { PullUpEngine } from '@/modules/pull-up/engine';
import { OverheadPressEngine } from '@/modules/overhead-press/engine';
import { BarbellRowEngine } from '@/modules/barbell-row/engine';
import { RomanianDeadliftEngine } from '@/modules/romanian-deadlift/engine';
import type { DeadliftFrameMetrics, DeadliftRepEvent } from '@/modules/conventional-deadlift/types';
import type { PullUpFrameMetrics } from '@/modules/pull-up/types';
import type { OHPFrameMetrics } from '@/modules/overhead-press/types';
import type { RowFrameMetrics, RowRepEvent } from '@/modules/barbell-row/types';
import type { RDLFrameMetrics, RDLRepEvent } from '@/modules/romanian-deadlift/types';
import { HammerCurlEngine } from '@/modules/hammer-curl/engine';
import { KettlebellSwingEngine } from '@/modules/kettlebell-swing/engine';
import type { KBSwingFrameMetrics, KBSwingRepEvent } from '@/modules/kettlebell-swing/types';
import { MountainClimberEngine } from '@/modules/mountain-climber/engine';
import type { MountainClimberFrameMetrics, MountainClimberRepEvent } from '@/modules/mountain-climber/types';
import { BurpeeEngine } from '@/modules/burpee/engine';
import type { BurpeeFrameMetrics, BurpeeRepEvent } from '@/modules/burpee/types';
import { BoxJumpEngine } from '@/modules/box-jump/engine';
import type { BoxJumpFrameMetrics, BoxJumpRepEvent } from '@/modules/box-jump/types';
import { StarJumpEngine } from '@/modules/star-jump/engine';
import type { StarJumpFrameMetrics, StarJumpRepEvent } from '@/modules/star-jump/types';
import { GluteBridgeEngine } from '@/modules/glute-bridge/engine';
import type { GluteBridgeFrameMetrics } from '@/modules/glute-bridge/types';
import { OTEEngine } from '@/modules/overhead-tricep-extension/engine';
import type { OTEFrameMetrics } from '@/modules/overhead-tricep-extension/types';
import { BroadJumpEngine } from '@/modules/broad-jump/engine';
import type { BroadJumpFrameMetrics, BroadJumpRepEvent } from '@/modules/broad-jump/types';
import { ChairDipEngine } from '@/modules/chair-dip/engine';
import type { ChairDipFrameMetrics } from '@/modules/chair-dip/types';
import { DeadBugEngine } from '@/modules/dead-bug/engine';
import type { DeadBugFrameMetrics } from '@/modules/dead-bug/types';
import { InchwormEngine } from '@/modules/inchworm/engine';
import type { InchwormFrameMetrics } from '@/modules/inchworm/types';
import { JumpSquatEngine } from '@/modules/jump-squat/engine';
import type { JumpSquatFrameMetrics, JumpSquatRepEvent } from '@/modules/jump-squat/types';
import type { HammerCurlFrameMetrics } from '@/modules/hammer-curl/types';
import { CurtsyLungeEngine } from '@/modules/curtsy-lunge/engine';
import type { CurtsyLungeFrameMetrics, CurtsyLungeRepEvent } from '@/modules/curtsy-lunge/types';
import { PallofPressEngine } from '@/modules/pallof-press/engine';
import type { PallofPressFrameMetrics, PallofPressRepEvent } from '@/modules/pallof-press/types';
import { LateralBandWalkEngine } from '@/modules/lateral-band-walk/engine';
import type { LateralBandWalkFrameMetrics, LateralBandWalkRepEvent } from '@/modules/lateral-band-walk/types';
import { PistolSquatEngine } from '@/modules/pistol-squat/engine';
import type { PistolSquatFrameMetrics, PistolSquatRepEvent } from '@/modules/pistol-squat/types';
import { NordicCurlEngine } from '@/modules/nordic-curl/engine';
import type { NordicCurlFrameMetrics, NordicCurlRepEvent } from '@/modules/nordic-curl/types';
import { ClamshellEngine } from '@/modules/clamshell/engine';
import type { ClamshellFrameMetrics, ClamshellRepEvent } from '@/modules/clamshell/types';
import type { ShrugFrameMetrics, ShrugRepEvent } from '@/modules/shrug/types';
import { SupermanEngine } from '@/modules/superman/engine';
import type { SupermanFrameMetrics } from '@/modules/superman/types';
import type { StepUpFrameMetrics, StepUpRepEvent } from '@/modules/step-up/types';
import type { GobletSquatFrameMetrics, GobletSquatRepEvent } from '@/modules/goblet-squat/types';
import type { FireHydrantFrameMetrics, FireHydrantRepEvent } from '@/modules/fire-hydrant/types';
import type { DonkeyKickFrameMetrics, DonkeyKickRepEvent } from '@/modules/donkey-kick/types';
import type { CalibrationUpdate, FrameMetrics } from '@/modules/squat/types';
import type { PlankFrameMetrics } from '@/modules/plank/types';
import type { PushupFrameMetrics } from '@/modules/pushup/types';
import type { LungeFrameMetrics, LungeRepEvent } from '@/modules/lunge/types';
import type { TandemStandFrameMetrics } from '@/modules/tandem-stand/types';
import type { BicepCurlFrameMetrics } from '@/modules/bicep-curl/types';
import type { SingleLegStandFrameMetrics } from '@/modules/single-leg-stand/types';
import type { StarPoseFrameMetrics } from '@/modules/star-pose/types';
import type { Figure4FrameMetrics } from '@/modules/standing-figure-4/types';
import type { GatePoseFrameMetrics } from '@/modules/gate-pose/types';
import type { ChairPoseFrameMetrics } from '@/modules/chair-pose/types';
import type { LateralRaiseFrameMetrics } from '@/modules/lateral-raise/types';
import type { TreePoseFrameMetrics } from '@/modules/tree-pose/types';
import type { WarriorTwoFrameMetrics } from '@/modules/warrior-2/types';
import type { WarriorOneFrameMetrics } from '@/modules/warrior-1/types';
import type { WarriorThreeFrameMetrics } from '@/modules/warrior-3/types';
import type { SidePlankFrameMetrics } from '@/modules/side-plank/types';
import type { BoatPoseFrameMetrics } from '@/modules/boat-pose/types';
import type { MountainPoseFrameMetrics } from '@/modules/mountain-pose/types';
import type { CalfRaiseFrameMetrics } from '@/modules/calf-raise/types';
import type { JumpingJacksFrameMetrics } from '@/modules/jumping-jacks/types';
import type { HighKneesFrameMetrics, HighKneesRepEvent } from '@/modules/high-knees/types';
import type { FrontRaiseFrameMetrics } from '@/modules/front-raise/types';
import type { ArmCirclesFrameMetrics, ArmCirclesRepEvent } from '@/modules/arm-circles/types';
import type { GoddessPoseFrameMetrics } from '@/modules/goddess-pose/types';
import type { TrianglePoseFrameMetrics } from '@/modules/triangle-pose/types';
import type { WallSitFrameMetrics } from '@/modules/wall-sit/types';
import type { SideLegRaiseFrameMetrics, SideLegRaiseRepEvent } from '@/modules/side-leg-raise/types';
import type { CatCowFrameMetrics, CatCowRepEvent } from '@/modules/cat-cow/types';
import type { SideBendFrameMetrics, SideBendRepEvent } from '@/modules/oblique-side-bend/types';
import type { SitToStandFrameMetrics, SitToStandRepEvent } from '@/modules/sit-to-stand/types';
import type { ForwardFoldFrameMetrics } from '@/modules/standing-forward-fold/types';
import type { DownwardDogFrameMetrics } from '@/modules/downward-dog/types';
import type { CobraPoseFrameMetrics } from '@/modules/cobra-pose/types';
import type { SeatedMarchFrameMetrics, SeatedMarchRepEvent } from '@/modules/seated-march/types';
import type { SeatedForwardFoldFrameMetrics } from '@/modules/seated-forward-fold/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from './types';

export interface RepRecord {
  index: number;
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
  atMs: number;
}

export interface WarningRecord {
  type: WarningType;
  atMs: number;
}

export interface SquatRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: FrameMetrics[];
}

export function runSquatSession(frames: Frame[]): SquatRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: FrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SquatEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface HoldTickRecord {
  secondsElapsed: number;
  mqs: number;
  atMs: number;
  /** 2026-05-25 round 9/10: longest continuous-unfrozen-form streak seen so
   *  far this hold (tandem stand initially; other hold engines as they receive
   *  the round-10 fix). Undefined for engines that don't track it yet. */
  longestUnfrozenSec?: number;
}

export interface PlankRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: PlankFrameMetrics[];
}

export function runPlankSession(frames: Frame[]): PlankRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: PlankFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PlankEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface PushupRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: PushupFrameMetrics[];
}

export function runPushupSession(frames: Frame[]): PushupRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: PushupFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PushupEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface LungeRepRecord extends LungeRepEvent {
  index: number;
  atMs: number;
}

export interface LungeRunResult {
  completedReps: LungeRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: LungeFrameMetrics[];
}

export function runLungeSession(frames: Frame[]): LungeRunResult {
  const completedReps: LungeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: LungeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new LungeEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

/** Lateral lunge reuses the lunge rep payload shape, so the run result type is
 *  identical to LungeRunResult. */
export type LateralLungeRunResult = LungeRunResult;

export function runLateralLungeSession(frames: Frame[]): LateralLungeRunResult {
  const completedReps: LungeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: LungeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new LateralLungeEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

/** Cossack squat reuses the lunge rep payload shape (LungeRunResult). */
export type CossackSquatRunResult = LungeRunResult;

export function runCossackSquatSession(frames: Frame[]): CossackSquatRunResult {
  const completedReps: LungeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: LungeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new CossackSquatEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface TandemStandRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: TandemStandFrameMetrics[];
}

export function runTandemStandSession(frames: Frame[]): TandemStandRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: TandemStandFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new TandemStandEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface BicepCurlRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: BicepCurlFrameMetrics[];
}

export function runBicepCurlSession(frames: Frame[]): BicepCurlRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: BicepCurlFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BicepCurlEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

/** 2026-05-28 round 22: calf-raise is now HOLD-based — runner emits hold
 *  ticks instead of rep records. */
export interface CalfRaiseHoldTickRecord {
  secondsElapsed: number;
  mqs: number;
  heelDropCount: number;
  atMs: number;
}

export interface CalfRaiseRunResult {
  holdTicks: CalfRaiseHoldTickRecord[];
  holdBroken: boolean;
  /** Final accumulated hold seconds (from the last hold-tick emission). */
  finalSecondsElapsed: number;
  finalHeelDropCount: number;
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: CalfRaiseFrameMetrics[];
}

export function runCalfRaiseSession(
  frames: Frame[],
  options: { targetDurationSec?: number } = {},
): CalfRaiseRunResult {
  const holdTicks: CalfRaiseHoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: CalfRaiseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let holdBroken = false;
  let currentTMs = 0;

  const engine = new CalfRaiseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      holdBroken = true;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  if (options.targetDurationSec !== undefined) {
    engine.setTargetDurationSec(options.targetDurationSec);
  }

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  const lastTick = holdTicks.length > 0 ? holdTicks[holdTicks.length - 1] : null;
  return {
    holdTicks,
    holdBroken,
    finalSecondsElapsed: lastTick?.secondsElapsed ?? 0,
    finalHeelDropCount: lastTick?.heelDropCount ?? 0,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface JumpingJacksRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: JumpingJacksFrameMetrics[];
}

export function runJumpingJacksSession(frames: Frame[]): JumpingJacksRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: JumpingJacksFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new JumpingJacksEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface ArmCirclesRepRecord extends ArmCirclesRepEvent {
  index: number;
  atMs: number;
}

export interface ArmCirclesRunResult {
  completedReps: ArmCirclesRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: ArmCirclesFrameMetrics[];
}

export function runArmCirclesSession(frames: Frame[]): ArmCirclesRunResult {
  const completedReps: ArmCirclesRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: ArmCirclesFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ArmCirclesEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface FrontRaiseRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: FrontRaiseFrameMetrics[];
}

export function runFrontRaiseSession(frames: Frame[]): FrontRaiseRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: FrontRaiseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new FrontRaiseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface HighKneesRepRecord extends HighKneesRepEvent {
  index: number;
  atMs: number;
}

export interface HighKneesRunResult {
  completedReps: HighKneesRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: HighKneesFrameMetrics[];
}

export function runHighKneesSession(frames: Frame[]): HighKneesRunResult {
  const completedReps: HighKneesRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: HighKneesFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new HighKneesEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface SingleLegStandRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: SingleLegStandFrameMetrics[];
}

export function runSingleLegStandSession(frames: Frame[]): SingleLegStandRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SingleLegStandFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SingleLegStandEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface StarPoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: StarPoseFrameMetrics[];
}

export function runStarPoseSession(frames: Frame[]): StarPoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: StarPoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StarPoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface StandingFigure4RunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: Figure4FrameMetrics[];
}

export function runStandingFigure4Session(frames: Frame[]): StandingFigure4RunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: Figure4FrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StandingFigure4Engine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface GatePoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: GatePoseFrameMetrics[];
}

export function runGatePoseSession(frames: Frame[]): GatePoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: GatePoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new GatePoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface ChairPoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: ChairPoseFrameMetrics[];
}

export function runChairPoseSession(frames: Frame[]): ChairPoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: ChairPoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ChairPoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface LateralRaiseRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: LateralRaiseFrameMetrics[];
}

export function runLateralRaiseSession(frames: Frame[]): LateralRaiseRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: LateralRaiseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new LateralRaiseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface TreePoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: TreePoseFrameMetrics[];
}

export function runTreePoseSession(frames: Frame[]): TreePoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: TreePoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new TreePoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface WarriorTwoRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: WarriorTwoFrameMetrics[];
}

export function runWarriorTwoSession(frames: Frame[]): WarriorTwoRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: WarriorTwoFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new WarriorTwoEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface BoatPoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: BoatPoseFrameMetrics[];
}

export function runBoatPoseSession(frames: Frame[]): BoatPoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: BoatPoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BoatPoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface SidePlankRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: SidePlankFrameMetrics[];
}

export function runSidePlankSession(frames: Frame[]): SidePlankRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SidePlankFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SidePlankEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface WarriorThreeRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: WarriorThreeFrameMetrics[];
}

export function runWarrior3Session(frames: Frame[]): WarriorThreeRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: WarriorThreeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new WarriorThreeEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface WarriorOneRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: WarriorOneFrameMetrics[];
}

export function runWarriorOneSession(frames: Frame[]): WarriorOneRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: WarriorOneFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new WarriorOneEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface MountainPoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: MountainPoseFrameMetrics[];
}

export function runMountainPoseSession(frames: Frame[]): MountainPoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: MountainPoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new MountainPoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface GoddessPoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: GoddessPoseFrameMetrics[];
}

export function runGoddessPoseSession(frames: Frame[]): GoddessPoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: GoddessPoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new GoddessPoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface TrianglePoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: TrianglePoseFrameMetrics[];
}

export function runTrianglePoseSession(frames: Frame[]): TrianglePoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: TrianglePoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new TrianglePoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface WallSitRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: WallSitFrameMetrics[];
}

export function runWallSitSession(frames: Frame[]): WallSitRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: WallSitFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new WallSitEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => {
      holdTicks.push({ ...t, atMs: currentTMs });
    },
    onHoldBroken: () => {
      broken = true;
      brokenAtMs = currentTMs;
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface SideLegRaiseRepRecord extends SideLegRaiseRepEvent {
  index: number;
  atMs: number;
}

export interface SideLegRaiseRunResult {
  completedReps: SideLegRaiseRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: SideLegRaiseFrameMetrics[];
}

export function runSideLegRaiseSession(frames: Frame[]): SideLegRaiseRunResult {
  const completedReps: SideLegRaiseRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SideLegRaiseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SideLegRaiseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

/** Standing Leg Swing reuses the side-leg-raise rep payload + frame shapes
 *  (same per-side hip-abduction movement, just a faster tempo). */
export type StandingLegSwingRunResult = SideLegRaiseRunResult;

export function runStandingLegSwingSession(frames: Frame[]): StandingLegSwingRunResult {
  const completedReps: SideLegRaiseRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SideLegRaiseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StandingLegSwingEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface CatCowRepRecord extends CatCowRepEvent {
  index: number;
  atMs: number;
}

export interface CatCowRunResult {
  completedReps: CatCowRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: CatCowFrameMetrics[];
}

export function runCatCowSession(frames: Frame[]): CatCowRunResult {
  const completedReps: CatCowRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: CatCowFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new CatCowEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface SideBendRepRecord extends SideBendRepEvent {
  index: number;
  atMs: number;
}

export interface SideBendRunResult {
  completedReps: SideBendRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: SideBendFrameMetrics[];
}

export function runObliqueSideBendSession(frames: Frame[]): SideBendRunResult {
  const completedReps: SideBendRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SideBendFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SideBendEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface ReverseLungeRunResult {
  completedReps: LungeRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: LungeFrameMetrics[];
}

export function runReverseLungeSession(frames: Frame[]): ReverseLungeRunResult {
  const completedReps: LungeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: LungeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ReverseLungeEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface SitToStandRepRecord extends SitToStandRepEvent {
  index: number;
  atMs: number;
}

export interface SitToStandRunResult {
  completedReps: SitToStandRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: SitToStandFrameMetrics[];
}

export function runSitToStandSession(frames: Frame[]): SitToStandRunResult {
  const completedReps: SitToStandRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SitToStandFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SitToStandEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface ForwardFoldRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: ForwardFoldFrameMetrics[];
}

export function runStandingForwardFoldSession(frames: Frame[]): ForwardFoldRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: ForwardFoldFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StandingForwardFoldEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface DownwardDogRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: DownwardDogFrameMetrics[];
}

export function runDownwardDogSession(frames: Frame[]): DownwardDogRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: DownwardDogFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new DownwardDogEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface CobraPoseRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: CobraPoseFrameMetrics[];
}

export function runCobraPoseSession(frames: Frame[]): CobraPoseRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: CobraPoseFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new CobraPoseEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

export interface SeatedMarchRepRecord extends SeatedMarchRepEvent {
  index: number;
  atMs: number;
}

export interface SeatedMarchRunResult {
  completedReps: SeatedMarchRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: SeatedMarchFrameMetrics[];
}

export function runSeatedMarchSession(frames: Frame[]): SeatedMarchRunResult {
  const completedReps: SeatedMarchRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SeatedMarchFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SeatedMarchEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface SeatedForwardFoldRunResult {
  calibrationConfirmedAtMs: number | null;
  finalCalibration: CalibrationUpdate | null;
  holdTicks: HoldTickRecord[];
  warnings: WarningRecord[];
  broken: boolean;
  brokenAtMs: number | null;
  frameMetricsSamples: SeatedForwardFoldFrameMetrics[];
}

export function runSeatedForwardFoldSession(frames: Frame[]): SeatedForwardFoldRunResult {
  const holdTicks: HoldTickRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: SeatedForwardFoldFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let broken = false;
  let brokenAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new SeatedForwardFoldEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onHoldTick: (t) => { holdTicks.push({ ...t, atMs: currentTMs }); },
    onHoldBroken: () => { broken = true; brokenAtMs = currentTMs; },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    calibrationConfirmedAtMs,
    finalCalibration,
    holdTicks,
    warnings,
    broken,
    brokenAtMs,
    frameMetricsSamples,
  };
}

/** Helper: count warnings of a specific type. */
export function countWarnings(result: { warnings: WarningRecord[] }, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

/** Helper: warnings other than a specific type (useful for "no other warnings" assertions). */
export function warningsOtherThan(
  result: { warnings: WarningRecord[] },
  ...allowed: WarningType[]
): WarningRecord[] {
  return result.warnings.filter((w) => !allowed.includes(w.type));
}

// ====================================================================
// Strength-exercise session runners (ported from Bilal's harness)
// ====================================================================
export interface DeadliftRepRecord extends DeadliftRepEvent {
  index: number;
  atMs: number;
}

export interface DeadliftRunResult {
  completedReps: DeadliftRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: DeadliftFrameMetrics[];
}

export function runDeadliftSession(frames: Frame[]): DeadliftRunResult {
  const completedReps: DeadliftRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: DeadliftFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ConventionalDeadliftEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface PullUpRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: PullUpFrameMetrics[];
}

export function runPullUpSession(frames: Frame[]): PullUpRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: PullUpFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PullUpEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface OHPRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: OHPFrameMetrics[];
}

export function runOverheadPressSession(frames: Frame[]): OHPRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: OHPFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new OverheadPressEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface RowRepRecord extends RowRepEvent {
  index: number;
  atMs: number;
}

export interface RowRunResult {
  completedReps: RowRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: RowFrameMetrics[];
}

export function runRowSession(frames: Frame[]): RowRunResult {
  const completedReps: RowRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: RowFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BarbellRowEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface RDLRepRecord extends RDLRepEvent {
  index: number;
  atMs: number;
}

export interface RDLRunResult {
  completedReps: RDLRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: RDLFrameMetrics[];
}

export function runRDLSession(frames: Frame[]): RDLRunResult {
  const completedReps: RDLRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: RDLFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new RomanianDeadliftEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// ====================================================================
// New exercise session runners (ported from kriya-mirror)
// ====================================================================
export interface HammerCurlRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: HammerCurlFrameMetrics[];
}

export function runHammerCurlSession(frames: Frame[]): HammerCurlRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: HammerCurlFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new HammerCurlEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface MCRepRecord extends MountainClimberRepEvent {
  index: number;
  atMs: number;
}

export interface MCRunResult {
  completedReps: MCRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: MountainClimberFrameMetrics[];
}

export function runMountainClimberSession(frames: Frame[]): MCRunResult {
  const completedReps: MCRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: MountainClimberFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new MountainClimberEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

export interface BurpeeRepRecord extends BurpeeRepEvent {
  index: number;
  atMs: number;
}

export interface BurpeeRunResult {
  completedReps: BurpeeRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: BurpeeFrameMetrics[];
}

export function runBurpeeSession(frames: Frame[]): BurpeeRunResult {
  const completedReps: BurpeeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: BurpeeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BurpeeEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}
export interface KBSwingRepRecord extends KBSwingRepEvent {
  index: number;
  atMs: number;
}

export interface KBSwingRunResult {
  completedReps: KBSwingRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: KBSwingFrameMetrics[];
}

export function runKBSwingSession(frames: Frame[]): KBSwingRunResult {
  const completedReps: KBSwingRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: KBSwingFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new KettlebellSwingEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// â”€â”€â”€ BOX JUMP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface BoxJumpRepRecord extends BoxJumpRepEvent {
  index: number;
  atMs: number;
}

export interface BoxJumpRunResult {
  completedReps: BoxJumpRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: BoxJumpFrameMetrics[];
}

export function runBoxJumpSession(frames: Frame[]): BoxJumpRunResult {
  const completedReps: BoxJumpRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: BoxJumpFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BoxJumpEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}
// â”€â”€â”€ STAR JUMP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StarJumpRepRecord extends StarJumpRepEvent {
  index: number;
  atMs: number;
}

export interface StarJumpRunResult {
  completedReps: StarJumpRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: StarJumpFrameMetrics[];
}

export function runStarJumpSession(frames: Frame[]): StarJumpRunResult {
  const completedReps: StarJumpRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: StarJumpFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StarJumpEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// â”€â”€â”€ GLUTE BRIDGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GluteBridgeRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: GluteBridgeFrameMetrics[];
}

export function runGluteBridgeSession(frames: Frame[]): GluteBridgeRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: GluteBridgeFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new GluteBridgeEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// â”€â”€â”€ OVERHEAD TRICEP EXTENSION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface OTERunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: OTEFrameMetrics[];
}

export function runOTESession(frames: Frame[]): OTERunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: OTEFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new OTEEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// â”€â”€â”€ BROAD JUMP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface BroadJumpRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  calibrationUpdates: CalibrationUpdate[];
  frameMetricsSamples: BroadJumpFrameMetrics[];
}

export function runBroadJumpSession(frames: Frame[]): BroadJumpRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: BroadJumpFrameMetrics[] = [];
  const calibrationUpdates: CalibrationUpdate[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BroadJumpEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      calibrationUpdates.push(u);
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: BroadJumpRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics: BroadJumpFrameMetrics) => {
      if (frameMetricsSamples.length < 200) frameMetricsSamples.push(metrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, calibrationUpdates, frameMetricsSamples };
}

// â”€â”€â”€ DEAD BUG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DeadBugRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: DeadBugFrameMetrics[];
}

export function runDeadBugSession(frames: Frame[]): DeadBugRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: DeadBugFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new DeadBugEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as DeadBugFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ INCHWORM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface InchwormRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: InchwormFrameMetrics[];
}

export function runInchwormSession(frames: Frame[]): InchwormRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: InchwormFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new InchwormEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as InchwormFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ JUMP SQUAT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface JumpSquatRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  calibrationUpdates: CalibrationUpdate[];
  frameMetricsSamples: JumpSquatFrameMetrics[];
}

export function runJumpSquatSession(frames: Frame[]): JumpSquatRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: JumpSquatFrameMetrics[] = [];
  const calibrationUpdates: CalibrationUpdate[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new JumpSquatEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      calibrationUpdates.push(u);
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: JumpSquatRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics: JumpSquatFrameMetrics) => {
      if (frameMetricsSamples.length < 200) frameMetricsSamples.push(metrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, calibrationUpdates, frameMetricsSamples };
}
// --- SUPERMAN ----------------------------------------------------------------

export interface SupermanRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: SupermanFrameMetrics[];
}

export function runSupermanSession(frames: Frame[]): SupermanRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: SupermanFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new SupermanEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as SupermanFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ BIRD-DOG / STEP-UP / WALKING LUNGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// â”€â”€â”€ SHRUG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


export interface ShrugRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: ShrugFrameMetrics[];
}

export function runShrugSession(frames: Frame[]): ShrugRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: ShrugFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new ShrugEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as ShrugFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ BIRD-DOG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface BirdDogRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: BirdDogFrameMetrics[];
}

export function runBirdDogSession(frames: Frame[]): BirdDogRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: BirdDogFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new BirdDogEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as BirdDogFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ STEP-UP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StepUpRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: StepUpFrameMetrics[];
}

export function runStepUpSession(frames: Frame[]): StepUpRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: StepUpFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new StepUpEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as StepUpFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ WALKING LUNGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WalkingLungeRepRecord {
  index: number;
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
  atMs: number;
  frontLeg: 'left' | 'right';
}

export interface WalkingLungeRunResult {
  completedReps: WalkingLungeRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: WalkingLungeFrameMetrics[];
}

export function runWalkingLungeSession(frames: Frame[]): WalkingLungeRunResult {
  const completedReps: WalkingLungeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: WalkingLungeFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new WalkingLungeEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: WalkingLungeRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
        frontLeg: rep.frontLeg,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as WalkingLungeFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ REVERSE FLY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ReverseFlyRepRecord extends ReverseFlyRepEvent {
  index: number;
  atMs: number;
}

export interface ReverseFlyRunResult {
  completedReps: ReverseFlyRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: ReverseFlyFrameMetrics[];
}

export function runReverseFlySession(frames: Frame[]): ReverseFlyRunResult {
  const completedReps: ReverseFlyRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: ReverseFlyFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ReverseFlyEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r: ReverseFlyRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// â”€â”€â”€ GOBLET SQUAT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GobletSquatRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: GobletSquatFrameMetrics[];
}

export function runGobletSquatSession(frames: Frame[]): GobletSquatRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: GobletSquatFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new GobletSquatEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: r.depthDeg,
        smoothness: r.smoothness,
        form: r.form,
        mqs: r.mqs,
        warnings: r.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}

// â”€â”€â”€ FIRE HYDRANT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface FireHydrantRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: FireHydrantFrameMetrics[];
}

export function runFireHydrantSession(frames: Frame[]): FireHydrantRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: FireHydrantFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new FireHydrantEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as FireHydrantFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ DONKEY KICK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DonkeyKickRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: DonkeyKickFrameMetrics[];
}

export function runDonkeyKickSession(frames: Frame[]): DonkeyKickRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: DonkeyKickFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new DonkeyKickEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as DonkeyKickFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ CURTSY LUNGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CurtsyLungeRepRecord extends RepRecord {
  peakDepthDeg: number;
}

export interface CurtsyLungeRunResult {
  completedReps: CurtsyLungeRepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: CurtsyLungeFrameMetrics[];
}

export function runCurtsyLungeSession(frames: Frame[]): CurtsyLungeRunResult {
  const completedReps: CurtsyLungeRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: CurtsyLungeFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new CurtsyLungeEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: CurtsyLungeRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.peakDepthDeg,
        peakDepthDeg: rep.peakDepthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as CurtsyLungeFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ PALLOF PRESS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface PallofPressRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: PallofPressFrameMetrics[];
}

export function runPallofPressSession(frames: Frame[]): PallofPressRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: PallofPressFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new PallofPressEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: PallofPressRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as PallofPressFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ LATERAL BAND WALK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LateralBandWalkStepRecord {
  index: number;
  stepDirection: 'left' | 'right' | null;
  peakDisplacement: number;
  mqs: number;
  warnings: WarningType[];
  atMs: number;
}

export interface LateralBandWalkRunResult {
  completedReps: LateralBandWalkStepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: LateralBandWalkFrameMetrics[];
}

export function runLateralBandWalkSession(frames: Frame[]): LateralBandWalkRunResult {
  const completedReps: LateralBandWalkStepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  const frameMetricsSamples: LateralBandWalkFrameMetrics[] = [];
  let currentTMs = 0;

  const engine = new LateralBandWalkEngine({
    onCalibrationUpdate: (update) => {
      finalCalibration = update;
      if (update.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: LateralBandWalkRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        stepDirection: rep.stepDirection,
        peakDisplacement: rep.peakDisplacement,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (metrics) => {
      frameMetricsSamples.push(metrics as LateralBandWalkFrameMetrics);
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

// â”€â”€â”€ Pistol Squat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface PistolSquatRepRecord {
  index: number;
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: import('@/store/workout').WarningType[];
  standingLeg: 'left' | 'right';
  atMs: number;
}

export interface PistolSquatRunResult {
  completedReps: PistolSquatRepRecord[];
  warnings: WarningRecord[];
  frameMetricsSamples: PistolSquatFrameMetrics[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

export function runPistolSquatSession(frames: Frame[]): PistolSquatRunResult {
  const completedReps: PistolSquatRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: PistolSquatFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PistolSquatEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({ index: completedReps.length + 1, ...r, atMs: currentTMs });
    },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m as PistolSquatFrameMetrics),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { completedReps, warnings, frameMetricsSamples, finalCalibration, calibrationConfirmedAtMs };
}

// â”€â”€â”€ Nordic Curl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface NordicCurlRepRecord {
  index: number;
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: import('@/store/workout').WarningType[];
  atMs: number;
}

export interface NordicCurlRunResult {
  completedReps: NordicCurlRepRecord[];
  warnings: WarningRecord[];
  frameMetricsSamples: NordicCurlFrameMetrics[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

export function runNordicCurlSession(frames: Frame[]): NordicCurlRunResult {
  const completedReps: NordicCurlRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: NordicCurlFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new NordicCurlEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({ index: completedReps.length + 1, ...r, atMs: currentTMs });
    },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m as NordicCurlFrameMetrics),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { completedReps, warnings, frameMetricsSamples, finalCalibration, calibrationConfirmedAtMs };
}

// â”€â”€â”€ Clamshell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ClamshellRepRecord {
  index: number;
  peakOpenFrac: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: import('@/store/workout').WarningType[];
  atMs: number;
}

export interface ClamshellRunResult {
  completedReps: ClamshellRepRecord[];
  warnings: WarningRecord[];
  frameMetricsSamples: ClamshellFrameMetrics[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

export function runClamshellSession(frames: Frame[]): ClamshellRunResult {
  const completedReps: ClamshellRepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: ClamshellFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ClamshellEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({ index: completedReps.length + 1, ...r, atMs: currentTMs });
    },
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (m) => frameMetricsSamples.push(m as ClamshellFrameMetrics),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { completedReps, warnings, frameMetricsSamples, finalCalibration, calibrationConfirmedAtMs };
}
export interface ChairDipRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: ChairDipFrameMetrics[];
}

export function runChairDipSession(frames: Frame[]): ChairDipRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  const frameMetricsSamples: ChairDipFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new ChairDipEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => {
      completedReps.push({
        index: completedReps.length + 1,
        ...r,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return {
    completedReps,
    warnings,
    finalCalibration,
    calibrationConfirmedAtMs,
    frameMetricsSamples,
  };
}
