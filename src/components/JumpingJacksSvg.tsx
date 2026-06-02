'use client';
import { useId } from 'react';

/**
 * Jumping Jacks stickman — front view, three variants:
 *   hero   — mid-jack (arms half-up + feet half-apart) — dynamic feel
 *   closed — start position: feet together, arms relaxed at sides
 *   open   — full extension: arms overhead, feet shoulder-width+ apart
 *
 * Each limb drawn as an individual <line>. Glow filter uses
 * filterUnits="userSpaceOnUse" with explicit region. Mirror color + stroke
 * conventions from TreePoseSvg / LateralRaiseSvg.
 */
type Variant = 'hero' | 'closed' | 'open';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function JumpingJacksSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `jj-glow-${uid}`;
  const floorId = `jj-floor-${uid}`;

  // Openness 0..1. closed=0, hero≈0.55, open=1.
  const openness = variant === 'closed' ? 0 : variant === 'open' ? 1 : 0.55;

  // Body anchors — centered figure.
  const MID_X = 180;
  const SHOULDER_Y = 64;
  const HIP_Y = 122;
  const ANKLE_Y = 178;

  const SHOULDER_HALF = 22;
  const LEFT_SHOULDER_X = MID_X - SHOULDER_HALF;
  const RIGHT_SHOULDER_X = MID_X + SHOULDER_HALF;
  const HIP_HALF = 14;
  const LEFT_HIP_X = MID_X - HIP_HALF;
  const RIGHT_HIP_X = MID_X + HIP_HALF;

  // Arms — at openness=0, wrists hang straight down below shoulders.
  // At openness=1, wrists are overhead and slightly inboard (hands meeting).
  // Lerp the wrist X/Y between the two endpoints.
  const ARM_LEN = 64;
  const downLeftWristX = LEFT_SHOULDER_X - 4;
  const downLeftWristY = SHOULDER_Y + ARM_LEN;
  const upLeftWristX = MID_X - 14;
  const upLeftWristY = SHOULDER_Y - ARM_LEN + 10;
  const leftWristX = downLeftWristX + (upLeftWristX - downLeftWristX) * openness;
  const leftWristY = downLeftWristY + (upLeftWristY - downLeftWristY) * openness;

  const downRightWristX = RIGHT_SHOULDER_X + 4;
  const downRightWristY = SHOULDER_Y + ARM_LEN;
  const upRightWristX = MID_X + 14;
  const upRightWristY = SHOULDER_Y - ARM_LEN + 10;
  const rightWristX = downRightWristX + (upRightWristX - downRightWristX) * openness;
  const rightWristY = downRightWristY + (upRightWristY - downRightWristY) * openness;

  // Elbow midpoints — slightly offset outward from the straight shoulder→wrist line
  // for a natural bend.
  const leftElbowX = (LEFT_SHOULDER_X + leftWristX) / 2 - 4 * (1 - openness * 0.5);
  const leftElbowY = (SHOULDER_Y + leftWristY) / 2;
  const rightElbowX = (RIGHT_SHOULDER_X + rightWristX) / 2 + 4 * (1 - openness * 0.5);
  const rightElbowY = (SHOULDER_Y + rightWristY) / 2;

  // Legs — at openness=0, ankles close together. At openness=1, ankles wide.
  const closedAnkleHalf = 10;
  const openAnkleHalf = 50;
  const ankleHalf = closedAnkleHalf + (openAnkleHalf - closedAnkleHalf) * openness;
  const LEFT_ANKLE_X = MID_X - ankleHalf;
  const RIGHT_ANKLE_X = MID_X + ankleHalf;

  const KNEE_Y = (HIP_Y + ANKLE_Y) / 2;

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
        <ellipse cx={MID_X} cy={ANKLE_Y + 6} rx="140" ry="5" fill={`url(#${floorId})`} />
        <line x1="40" y1={ANKLE_Y + 6} x2="320" y2={ANKLE_Y + 6} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference shoulder line for the open variant */}
        {variant === 'open' && (
          <line x1={LEFT_SHOULDER_X - 70} y1={SHOULDER_Y} x2={RIGHT_SHOULDER_X + 70} y2={SHOULDER_Y}
            stroke={AMBER} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.55" />
        )}

        {/* Torso — shoulder line + spine + hip line */}
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={RIGHT_SHOULDER_X} y2={SHOULDER_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={SHOULDER_Y} x2={MID_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_HIP_X} y1={HIP_Y} x2={RIGHT_HIP_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Legs */}
        <line x1={LEFT_HIP_X} y1={HIP_Y} x2={LEFT_ANKLE_X} y2={KNEE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_ANKLE_X} y1={KNEE_Y} x2={LEFT_ANKLE_X} y2={ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_HIP_X} y1={HIP_Y} x2={RIGHT_ANKLE_X} y2={KNEE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_ANKLE_X} y1={KNEE_Y} x2={RIGHT_ANKLE_X} y2={ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms — shoulder → elbow → wrist */}
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
          <circle cx={LEFT_ANKLE_X} cy={ANKLE_Y} r="3" />
          <circle cx={RIGHT_ANKLE_X} cy={ANKLE_Y} r="3" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
