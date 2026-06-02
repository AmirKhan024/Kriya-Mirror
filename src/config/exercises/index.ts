import type { ExerciseCategory, ExerciseConfig } from './types';
import { squatConfig } from './squat.config';
import { plankConfig } from './plank.config';
import { pushupConfig } from './pushup.config';
import { lungeConfig } from './lunge.config';
import { tandemStandConfig } from './tandem-stand.config';
import { bicepCurlConfig } from './bicep-curl.config';
import { singleLegStandConfig } from './single-leg-stand.config';
import { chairPoseConfig } from './chair-pose.config';
import { lateralRaiseConfig } from './lateral-raise.config';
import { treePoseConfig } from './tree-pose.config';
import { warriorTwoConfig } from './warrior-2.config';
import { warriorOneConfig } from './warrior-1.config';
import { warriorThreeConfig } from './warrior-3.config';
import { mountainPoseConfig } from './mountain-pose.config';
import { calfRaiseConfig } from './calf-raise.config';
import { jumpingJacksConfig } from './jumping-jacks.config';
import { highKneesConfig } from './high-knees.config';
import { frontRaiseConfig } from './front-raise.config';
import { armCirclesConfig } from './arm-circles.config';
import { goddessPoseConfig } from './goddess-pose.config';
import { trianglePoseConfig } from './triangle-pose.config';
import { wallSitConfig } from './wall-sit.config';
import { sideLegRaiseConfig } from './side-leg-raise.config';
import { obliqueSideBendConfig } from './oblique-side-bend.config';
import { reverseLungeConfig } from './reverse-lunge.config';
import { lateralLungeConfig } from './lateral-lunge.config';
import { sidePlankConfig } from './side-plank.config';
import { boatPoseConfig } from './boat-pose.config';
import { sitToStandConfig } from './sit-to-stand.config';
import { standingForwardFoldConfig } from './standing-forward-fold.config';
import { downwardDogConfig } from './downward-dog.config';
import { cobraPoseConfig } from './cobra-pose.config';
import { seatedMarchConfig } from './seated-march.config';
import { seatedForwardFoldConfig } from './seated-forward-fold.config';
import { starPoseConfig } from './star-pose.config';
import { standingFigure4Config } from './standing-figure-4.config';
import { gatePoseConfig } from './gate-pose.config';
import { cossackSquatConfig } from './cossack-squat.config';
import { standingLegSwingConfig } from './standing-leg-swing.config';
import { catCowConfig } from './cat-cow.config';
// Strength exercises (integrated from Bilal's repo)
import { conventionalDeadliftConfig } from './conventional-deadlift.config';
import { pullUpConfig } from './pull-up.config';
import { overheadPressConfig } from './overhead-press.config';
import { barbellRowConfig } from './barbell-row.config';
import { romanianDeadliftConfig } from './romanian-deadlift.config';
// New exercises (Bilal's round 2)
import { hammerCurlConfig } from './hammer-curl.config';
import { kettlebellSwingConfig } from './kettlebell-swing.config';
import { mountainClimberConfig } from './mountain-climber.config';
import { burpeeConfig } from './burpee.config';
import { boxJumpConfig } from './box-jump.config';
import { starJumpConfig } from './star-jump.config';
import { gluteBridgeConfig } from './glute-bridge.config';
import { overheadTricepExtensionConfig } from './overhead-tricep-extension.config';
import { broadJumpConfig } from './broad-jump.config';
import { chairDipConfig } from './chair-dip.config';
import { deadBugConfig } from './dead-bug.config';
import { inchwormConfig } from './inchworm.config';
import { shrugConfig } from './shrug.config';
import { supermanConfig } from './superman.config';
import { jumpSquatConfig } from './jump-squat.config';
import { birdDogConfig } from './bird-dog.config';
import { stepUpConfig } from './step-up.config';
import { walkingLungeConfig } from './walking-lunge.config';
import { reverseFlyConfig } from './reverse-fly.config';
import { gobletSquatConfig } from './goblet-squat.config';
import { donkeyKickConfig } from './donkey-kick.config';
import { fireHydrantConfig } from './fire-hydrant.config';
import { curtsyLungeConfig } from './curtsy-lunge.config';
import { pallofPressConfig } from './pallof-press.config';
import { lateralBandWalkConfig } from './lateral-band-walk.config';
import { pistolSquatConfig } from './pistol-squat.config';
import { nordicCurlConfig } from './nordic-curl.config';
import { clamshellConfig } from './clamshell.config';

export {
  squatConfig, plankConfig, pushupConfig, lungeConfig,
  tandemStandConfig, bicepCurlConfig, singleLegStandConfig,
  chairPoseConfig, lateralRaiseConfig, treePoseConfig, warriorTwoConfig,
  warriorOneConfig, warriorThreeConfig,
  mountainPoseConfig, calfRaiseConfig, jumpingJacksConfig, highKneesConfig,
  frontRaiseConfig, armCirclesConfig, goddessPoseConfig, trianglePoseConfig,
  wallSitConfig, sideLegRaiseConfig, obliqueSideBendConfig, reverseLungeConfig,
  lateralLungeConfig, sidePlankConfig, boatPoseConfig,
  sitToStandConfig, standingForwardFoldConfig, downwardDogConfig, cobraPoseConfig,
  seatedMarchConfig, seatedForwardFoldConfig, starPoseConfig, standingFigure4Config, gatePoseConfig,
  cossackSquatConfig, standingLegSwingConfig, catCowConfig,
  conventionalDeadliftConfig, pullUpConfig, overheadPressConfig,
  barbellRowConfig, romanianDeadliftConfig,
  hammerCurlConfig, kettlebellSwingConfig, mountainClimberConfig, burpeeConfig, boxJumpConfig,
  starJumpConfig, gluteBridgeConfig, overheadTricepExtensionConfig, broadJumpConfig, chairDipConfig,
  deadBugConfig, inchwormConfig, shrugConfig, supermanConfig, jumpSquatConfig, birdDogConfig,
  stepUpConfig, walkingLungeConfig, reverseFlyConfig, gobletSquatConfig, donkeyKickConfig,
  fireHydrantConfig, curtsyLungeConfig, pallofPressConfig, lateralBandWalkConfig,
  pistolSquatConfig, nordicCurlConfig, clamshellConfig,
};

export const ALL_EXERCISES: ExerciseConfig[] = [
  squatConfig, plankConfig, pushupConfig, lungeConfig,
  tandemStandConfig, bicepCurlConfig, singleLegStandConfig,
  chairPoseConfig, lateralRaiseConfig, treePoseConfig, warriorTwoConfig,
  warriorOneConfig, warriorThreeConfig,
  mountainPoseConfig, calfRaiseConfig, jumpingJacksConfig, highKneesConfig,
  frontRaiseConfig, armCirclesConfig, goddessPoseConfig, trianglePoseConfig,
  wallSitConfig, sideLegRaiseConfig, obliqueSideBendConfig, reverseLungeConfig,
  lateralLungeConfig, sidePlankConfig, boatPoseConfig,
  sitToStandConfig, standingForwardFoldConfig, downwardDogConfig, cobraPoseConfig,
  seatedMarchConfig, seatedForwardFoldConfig, starPoseConfig, standingFigure4Config, gatePoseConfig,
  cossackSquatConfig, standingLegSwingConfig, catCowConfig,
  conventionalDeadliftConfig, pullUpConfig, overheadPressConfig,
  barbellRowConfig, romanianDeadliftConfig,
  hammerCurlConfig, kettlebellSwingConfig, mountainClimberConfig, burpeeConfig, boxJumpConfig,
  starJumpConfig, gluteBridgeConfig, overheadTricepExtensionConfig, broadJumpConfig, chairDipConfig,
  deadBugConfig, inchwormConfig, shrugConfig, supermanConfig, jumpSquatConfig, birdDogConfig,
  stepUpConfig, walkingLungeConfig, reverseFlyConfig, gobletSquatConfig, donkeyKickConfig,
  fireHydrantConfig, curtsyLungeConfig, pallofPressConfig, lateralBandWalkConfig,
  pistolSquatConfig, nordicCurlConfig, clamshellConfig,
];

// getExerciseById intentionally does NOT filter on isVisible — a soft-deprecated
// exercise's route still resolves if navigated to directly (its page keeps working).
export function getExerciseById(id: string): ExerciseConfig | undefined {
  return ALL_EXERCISES.find((ex) => ex.id === id);
}

// The home catalog uses this — soft-deprecated exercises (isVisible === false)
// are hidden here while their code + route stay intact.
export function getExercisesByCategory(category: ExerciseCategory): ExerciseConfig[] {
  return ALL_EXERCISES.filter((ex) => ex.category === category && ex.isVisible !== false);
}
