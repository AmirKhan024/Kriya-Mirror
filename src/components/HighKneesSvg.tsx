'use client';
import { useId } from 'react';

/**
 * High Knees stickman — front view, three variants:
 *   hero     — mid-step: left knee fully up at hip height (canonical pose)
 *   left-up  — same as hero (alias)
 *   right-up — mirror: right knee fully up at hip height
 *
 * Each limb drawn as an individual <line>. Glow filter uses
 * filterUnits="userSpaceOnUse" with explicit region. Mirror color + stroke
 * conventions from JumpingJacksSvg / TreePoseSvg.
 */
type Variant = 'hero' | 'left-up' | 'right-up';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function HighKneesSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `hk-glow-${uid}`;
  const floorId = `hk-floor-${uid}`;

  // Which side is lifted. Hero = left up.
  const liftedSide: 'left' | 'right' = variant === 'right-up' ? 'right' : 'left';

  // Body anchors.
  const MID_X = 180;
  const SHOULDER_Y = 60;
  const HIP_Y = 118;
  const STANDING_ANKLE_Y = 178;

  const SHOULDER_HALF = 22;
  const LEFT_SHOULDER_X = MID_X - SHOULDER_HALF;
  const RIGHT_SHOULDER_X = MID_X + SHOULDER_HALF;
  const HIP_HALF = 14;
  const LEFT_HIP_X = MID_X - HIP_HALF;
  const RIGHT_HIP_X = MID_X + HIP_HALF;

  // Standing leg (planted) — straight from hip to ankle, ankle on floor.
  const standingHipX = liftedSide === 'left' ? RIGHT_HIP_X : LEFT_HIP_X;
  const standingAnkleX = liftedSide === 'left' ? RIGHT_HIP_X : LEFT_HIP_X;
  const standingKneeX = standingAnkleX;
  const standingKneeY = (HIP_Y + STANDING_ANKLE_Y) / 2;

  // Lifted leg — knee at hip height (the canonical high-knees target).
  const liftedHipX = liftedSide === 'left' ? LEFT_HIP_X : RIGHT_HIP_X;
  // Knee Y at hip height (or slightly above for "explosive" feel).
  const liftedKneeY = HIP_Y - 4;
  // Knee X — bent forward + slightly inward across the body (visible high-knee).
  const liftedKneeX = liftedSide === 'left' ? liftedHipX + 16 : liftedHipX - 16;
  // Ankle of the lifted leg — hangs below the knee at ~45° from vertical
  // (the foot dangles as the knee drives up).
  const liftedAnkleX = liftedKneeX + (liftedSide === 'left' ? -6 : 6);
  const liftedAnkleY = liftedKneeY + 30;

  // Arms — bent at the elbow, mirror the leg drive (opposition).
  // Lifted leg side → opposite arm drives back (elbow up by hip).
  // Standing leg side → opposite arm drives forward.
  const leftElbowY = SHOULDER_Y + 22;
  const rightElbowY = SHOULDER_Y + 22;
  const leftElbowX = LEFT_SHOULDER_X - 10;
  const rightElbowX = RIGHT_SHOULDER_X + 10;
  // Wrists raise toward chest in opposite phase. Lifted=left → right wrist up.
  const leftWristForward = liftedSide === 'right';
  const rightWristForward = liftedSide === 'left';
  const leftWristY = leftWristForward ? SHOULDER_Y + 8 : leftElbowY + 26;
  const leftWristX = leftWristForward ? LEFT_SHOULDER_X + 2 : LEFT_SHOULDER_X - 14;
  const rightWristY = rightWristForward ? SHOULDER_Y + 8 : rightElbowY + 26;
  const rightWristX = rightWristForward ? RIGHT_SHOULDER_X - 2 : RIGHT_SHOULDER_X + 14;

  return (
    <div className={className}>
      <svg viewBox="0 0 360 200" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="400" height="240">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Floor */}
        <ellipse cx={MID_X} cy={STANDING_ANKLE_Y + 6} rx="140" ry="5" fill={`url(#${floorId})`} />
        <line x1="40" y1={STANDING_ANKLE_Y + 6} x2="320" y2={STANDING_ANKLE_Y + 6} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Hip-height reference line (amber dashed) — visualises the target */}
        <line x1={liftedSide === 'left' ? 60 : 200} y1={HIP_Y} x2={liftedSide === 'left' ? 160 : 300} y2={HIP_Y}
          stroke={AMBER} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.55" />

        {/* Torso — shoulder line + spine + hip line */}
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={RIGHT_SHOULDER_X} y2={SHOULDER_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={SHOULDER_Y} x2={MID_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_HIP_X} y1={HIP_Y} x2={RIGHT_HIP_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Standing leg (planted) */}
        <line x1={standingHipX} y1={HIP_Y} x2={standingKneeX} y2={standingKneeY}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={standingKneeX} y1={standingKneeY} x2={standingAnkleX} y2={STANDING_ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Lifted leg — thigh driven up + shin dangling */}
        <line x1={liftedHipX} y1={HIP_Y} x2={liftedKneeX} y2={liftedKneeY}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={liftedKneeX} y1={liftedKneeY} x2={liftedAnkleX} y2={liftedAnkleY}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms — shoulder → elbow → wrist (each side independently) */}
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={leftElbowX} y2={leftElbowY}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={leftElbowX} y1={leftElbowY} x2={leftWristX} y2={leftWristY}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_SHOULDER_X} y1={SHOULDER_Y} x2={rightElbowX} y2={rightElbowY}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={rightElbowX} y1={rightElbowY} x2={rightWristX} y2={rightWristY}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={MID_X} cy={SHOULDER_Y - 22} r="14"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={RIGHT_SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={LEFT_HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={RIGHT_HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={leftElbowX} cy={leftElbowY} r="3" />
          <circle cx={rightElbowX} cy={rightElbowY} r="3" />
          <circle cx={leftWristX} cy={leftWristY} r="3" />
          <circle cx={rightWristX} cy={rightWristY} r="3" />
          <circle cx={standingKneeX} cy={standingKneeY} r="3" />
          <circle cx={standingAnkleX} cy={STANDING_ANKLE_Y} r="3" />
          <circle cx={liftedKneeX} cy={liftedKneeY} r="3" />
          <circle cx={liftedAnkleX} cy={liftedAnkleY} r="3" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
