'use client';
import Image from 'next/image';
import { PlankSvg } from './PlankSvg';
import { SquatSvg } from './SquatSvg';
import { PushupSvg } from './PushupSvg';
import { LungeSvg } from './LungeSvg';
import { TandemStandSvg } from './TandemStandSvg';
import { BicepCurlSvg } from './BicepCurlSvg';
import { SingleLegStandSvg } from './SingleLegStandSvg';
import { ChairPoseSvg } from './ChairPoseSvg';
import { LateralRaiseSvg } from './LateralRaiseSvg';
import { TreePoseSvg } from './TreePoseSvg';
import { WarriorTwoSvg } from './WarriorTwoSvg';
import { WarriorOneSvg } from './WarriorOneSvg';
import { WarriorThreeSvg } from './WarriorThreeSvg';
import { SidePlankSvg } from './SidePlankSvg';
import { BoatPoseSvg } from './BoatPoseSvg';
import { MountainPoseSvg } from './MountainPoseSvg';
import { CalfRaiseSvg } from './CalfRaiseSvg';
import { JumpingJacksSvg } from './JumpingJacksSvg';
import { HighKneesSvg } from './HighKneesSvg';
import { FrontRaiseSvg } from './FrontRaiseSvg';
import { ArmCirclesSvg } from './ArmCirclesSvg';
import { GoddessPoseSvg } from './GoddessPoseSvg';
import { TrianglePoseSvg } from './TrianglePoseSvg';
import { WallSitSvg } from './WallSitSvg';
import { SideLegRaiseSvg } from './SideLegRaiseSvg';
import { ObliqueSideBendSvg } from './ObliqueSideBendSvg';
import { ReverseLungeSvg } from './ReverseLungeSvg';
import { SitToStandSvg } from './SitToStandSvg';
import { ForwardFoldSvg } from './ForwardFoldSvg';
import { DownwardDogSvg } from './DownwardDogSvg';
import { CobraPoseSvg } from './CobraPoseSvg';
import { SeatedMarchSvg } from './SeatedMarchSvg';
import { SeatedForwardFoldSvg } from './SeatedForwardFoldSvg';
import { CatCowSvg } from './CatCowSvg';
import { StarPoseSvg } from './StarPoseSvg';

/**
 * Single source of truth for routing an `images.hero` value to the right
 * illustration component. Used by both the exercise detail page (via
 * `ImageTextMode`) and the workout setup page.
 *
 * Add a new exercise's SVG hero here once — both surfaces pick it up.
 * (Previously the routing was duplicated, and the setup page silently
 * dropped Push-Up. See .context/03_KNOWN_ISSUES_TO_PREVENT.md.)
 */
interface Props {
  heroId: string;
  name: string;
  className?: string;
}

export function HeroIllustration({ heroId, name, className = 'w-full max-w-md' }: Props) {
  if (heroId.startsWith('svg:plank'))  return <PlankSvg  variant="hero" className={className} />;
  if (heroId.startsWith('svg:squat'))  return <SquatSvg  variant="hero" className={className} />;
  if (heroId.startsWith('svg:pushup')) return <PushupSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:lunge'))  return <LungeSvg  variant="hero" className={className} />;
  if (heroId.startsWith('svg:tandem-stand')) return <TandemStandSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:bicep-curl')) return <BicepCurlSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:star-pose')) return <StarPoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:single-leg-stand')) return <SingleLegStandSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:chair-pose')) return <ChairPoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:lateral-raise')) return <LateralRaiseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:tree-pose')) return <TreePoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:warrior-2')) return <WarriorTwoSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:warrior-1')) return <WarriorOneSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:warrior-3')) return <WarriorThreeSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:side-plank')) return <SidePlankSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:boat-pose')) return <BoatPoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:mountain-pose')) return <MountainPoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:calf-raise')) return <CalfRaiseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:jumping-jacks')) return <JumpingJacksSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:high-knees')) return <HighKneesSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:front-raise')) return <FrontRaiseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:arm-circles')) return <ArmCirclesSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:goddess-pose')) return <GoddessPoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:triangle-pose')) return <TrianglePoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:wall-sit')) return <WallSitSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:side-leg-raise')) return <SideLegRaiseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:oblique-side-bend')) return <ObliqueSideBendSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:reverse-lunge')) return <ReverseLungeSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:sit-to-stand')) return <SitToStandSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:standing-forward-fold')) return <ForwardFoldSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:downward-dog')) return <DownwardDogSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:cobra-pose')) return <CobraPoseSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:seated-march')) return <SeatedMarchSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:seated-forward-fold')) return <SeatedForwardFoldSvg variant="hero" className={className} />;
  if (heroId.startsWith('svg:cat-cow')) return <CatCowSvg variant="hero" className={className} />;
  return <Image src={heroId} alt={name} fill className="object-contain" unoptimized />;
}
