'use client';
import { useId } from 'react';

/**
 * 2026-05-28 round 21: Front Raise stickman — FRONT view (re-architected from
 * side view to match the front-camera engine).
 *
 * Three variants:
 *   down — arms hanging at sides (start / end of rep)
 *   mid  — arms partially raised forward (~45°)
 *   top  — arms parallel to floor in FRONT (90° flexion)
 *
 * Visual cheat: pure forward into Z would project identically to "arms down"
 * in a 2D front view, so we render the wrists with a small outward offset
 * (~12° from body midline) for clarity. The wrists stay clearly INSIDE the
 * shoulder line (unlike lateral-raise where wrists end well outside shoulders).
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

export function FrontRaiseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `fr-glow-${uid}`;
  const floorId = `fr-floor-${uid}`;

  // Hero variant = top position.
  const effective = variant === 'hero' ? 'top' : variant;

  // Flexion angle: 0° = arm at side (vertical down), 90° = arm horizontal forward.
  const flexDeg = effective === 'down' ? 5 : effective === 'mid' ? 45 : 90;

  // Body geometry — centered, front view
  const SHOULDER_Y = 70;
  const HIP_Y = 130;
  const ANKLE_Y = 178;
  const LEFT_X = 145;
  const RIGHT_X = 215;
  const MID_X = (LEFT_X + RIGHT_X) / 2;

  // Arm geometry. The arm rotates forward (into Z) — projects mostly vertically
  // in 2D. We add a small outward visual offset so the wrists are visible.
  const ARM_LEN = 62;
  const flexRad = (flexDeg * Math.PI) / 180;
  // Vertical drop: arm starts straight down (cos = 1) and rotates up (cos → 0 at 90°).
  const verticalDrop = Math.cos(flexRad) * ARM_LEN;
  // Visual outward offset: amplified at high flexion so wrists are visible.
  // At flexDeg=90, wrists sit ~25 px inside the shoulder X (clearly NOT a lateral raise).
  const outwardOffset = Math.sin(flexRad) * 12;
  const leftWristX = LEFT_X - outwardOffset;
  const leftWristY = SHOULDER_Y + verticalDrop;
  const rightWristX = RIGHT_X + outwardOffset;
  const rightWristY = SHOULDER_Y + verticalDrop;

  const leftElbowX = (LEFT_X + leftWristX) / 2;
  const leftElbowY = (SHOULDER_Y + leftWristY) / 2;
  const rightElbowX = (RIGHT_X + rightWristX) / 2;
  const rightElbowY = (SHOULDER_Y + rightWristY) / 2;

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

        {/* Torso (shoulder line + spine) */}
        <line x1={LEFT_X} y1={SHOULDER_Y} x2={RIGHT_X} y2={SHOULDER_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={SHOULDER_Y} x2={MID_X} y2={HIP_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Legs */}
        <line x1={MID_X} y1={HIP_Y} x2={LEFT_X + 5} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={HIP_Y} x2={RIGHT_X - 5} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms — shoulder → elbow → wrist (forward in front of body) */}
        <line x1={LEFT_X} y1={SHOULDER_Y} x2={leftElbowX} y2={leftElbowY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={leftElbowX} y1={leftElbowY} x2={leftWristX} y2={leftWristY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_X} y1={SHOULDER_Y} x2={rightElbowX} y2={rightElbowY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={rightElbowX} y1={rightElbowY} x2={rightWristX} y2={rightWristY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={MID_X} cy={SHOULDER_Y - 22} r="14"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={RIGHT_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={MID_X} cy={HIP_Y} r="3.5" />
          <circle cx={leftElbowX} cy={leftElbowY} r="3" />
          <circle cx={rightElbowX} cy={rightElbowY} r="3" />
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
