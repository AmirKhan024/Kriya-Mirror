'use client';
import { useId } from 'react';

/**
 * Lateral Raise stickman — front view, three variants:
 *   down — arms hanging at sides (start / end of rep)
 *   mid  — arms partially raised (~45° abduction)
 *   top  — arms parallel to floor (~90° abduction)
 *
 * Each limb drawn as an individual <line> (NOT a polyline — see PlankSvg
 * for the collinear-polyline rendering bug). Glow filter uses
 * filterUnits="userSpaceOnUse" with explicit region so horizontal lines
 * (zero-height bounding box) don't get clipped.
 */
type Variant = 'hero' | 'down' | 'mid' | 'top';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function LateralRaiseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `lr-glow-${uid}`;
  const floorId = `lr-floor-${uid}`;

  // Hero variant = top position (default illustration).
  const effective = variant === 'hero' ? 'top' : variant;

  // Angle of arm from shoulder (degrees from vertical-down).
  const armDeg = effective === 'down' ? 5 : effective === 'mid' ? 45 : 90;

  // Body geometry — centered
  const SHOULDER_Y = 70;
  const HIP_Y = 130;
  const ANKLE_Y = 178;
  const LEFT_X = 145;
  const RIGHT_X = 215;
  const MID_X = (LEFT_X + RIGHT_X) / 2;

  // Compute wrist position for both arms
  const ARM_LEN = 62;
  const a = (armDeg * Math.PI) / 180;
  const leftWristX = LEFT_X - Math.sin(a) * ARM_LEN;
  const leftWristY = SHOULDER_Y + Math.cos(a) * ARM_LEN;
  const rightWristX = RIGHT_X + Math.sin(a) * ARM_LEN;
  const rightWristY = SHOULDER_Y + Math.cos(a) * ARM_LEN;

  // Color: hero/top = teal (correct); down/mid = teal (also correct, just shown as progression)
  const bodyColor = TEAL;

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
        <ellipse cx={MID_X} cy={ANKLE_Y + 6} rx="120" ry="5" fill={`url(#${floorId})`} />
        <line x1="50" y1={ANKLE_Y + 6} x2="310" y2={ANKLE_Y + 6} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference shoulder line for non-top variants */}
        {effective !== 'top' && (
          <line x1={LEFT_X - 70} y1={SHOULDER_Y} x2={RIGHT_X + 70} y2={SHOULDER_Y}
            stroke={AMBER} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.55" />
        )}

        {/* Torso (shoulder line + spine + hips) */}
        <line x1={LEFT_X} y1={SHOULDER_Y} x2={RIGHT_X} y2={SHOULDER_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={SHOULDER_Y} x2={MID_X} y2={HIP_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Legs */}
        <line x1={MID_X} y1={HIP_Y} x2={LEFT_X + 5} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={HIP_Y} x2={RIGHT_X - 5} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms */}
        <line x1={LEFT_X} y1={SHOULDER_Y} x2={leftWristX} y2={leftWristY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_X} y1={SHOULDER_Y} x2={rightWristX} y2={rightWristY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={MID_X} cy={SHOULDER_Y - 22} r="14"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={RIGHT_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={MID_X} cy={HIP_Y} r="3.5" />
          <circle cx={leftWristX} cy={leftWristY} r="3.5" />
          <circle cx={rightWristX} cy={rightWristY} r="3.5" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
