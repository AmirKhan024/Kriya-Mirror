'use client';
import { useId } from 'react';

/**
 * Seated March stickman — FRONT view, seated on a chair, three variants:
 *   hero / left-up — left knee lifted toward the chest (right foot on the floor)
 *   right-up       — right knee lifted (left foot on the floor)
 *
 * The chair is drawn in a muted tone behind/under the figure so it reads clearly
 * as a seated person (not the chair). Body drawn as individual <line> elements
 * (no polyline — see PlankSvg.tsx). Glow filter uses filterUnits="userSpaceOnUse".
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

export function SeatedMarchSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sm-glow-${uid}`;
  const floorId = `sm-floor-${uid}`;

  const leftUp = variant === 'hero' || variant === 'left-up';

  const FLOOR_Y = 186;
  const SEAT_Y = 124;
  const cx = 180;

  // Torso
  const HEAD_Y = 44;
  const SHOULDER_Y = 72;
  const shoulderHalf = 26;
  const HIP_Y = 120;
  const hipHalf = 16;

  // Legs: lifted knee rides up near the hip; resting knee sits lower with the
  // foot on the floor.
  const liftedKneeY = 126;     // knee raised (near hip height)
  const liftedFootY = 150;     // foot dangling off the floor
  const restKneeY = 156;
  const restFootY = FLOOR_Y;

  const leftHipX = cx - hipHalf;
  const rightHipX = cx + hipHalf;

  // Left leg
  const leftKneeX = leftUp ? cx - 22 : cx - 20;
  const leftKneeY = leftUp ? liftedKneeY : restKneeY;
  const leftFootX = leftUp ? cx - 30 : cx - 22;
  const leftFootY = leftUp ? liftedFootY : restFootY;
  // Right leg
  const rightKneeX = !leftUp ? cx + 22 : cx + 20;
  const rightKneeY = !leftUp ? liftedKneeY : restKneeY;
  const rightFootX = !leftUp ? cx + 30 : cx + 22;
  const rightFootY = !leftUp ? liftedFootY : restFootY;

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
        <ellipse cx={cx} cy={FLOOR_Y + 4} rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="30" y1={FLOOR_Y + 2} x2="330" y2={FLOOR_Y + 2} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Chair (muted, behind the figure) */}
        <g stroke={MUTED} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.8">
          {/* seat */}
          <line x1={cx - 46} y1={SEAT_Y} x2={cx + 46} y2={SEAT_Y} />
          {/* backrest */}
          <line x1={cx + 46} y1={SEAT_Y} x2={cx + 46} y2={SEAT_Y - 56} />
          <line x1={cx + 38} y1={SEAT_Y - 50} x2={cx + 46} y2={SEAT_Y - 50} />
          {/* front + back legs */}
          <line x1={cx - 40} y1={SEAT_Y} x2={cx - 40} y2={FLOOR_Y} />
          <line x1={cx + 40} y1={SEAT_Y} x2={cx + 40} y2={FLOOR_Y} />
        </g>

        {/* Head */}
        <circle cx={cx} cy={HEAD_Y} r="14" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Shoulders + torso */}
        <line x1={cx - shoulderHalf} y1={SHOULDER_Y} x2={cx + shoulderHalf} y2={SHOULDER_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={cx} y1={SHOULDER_Y} x2={cx} y2={HIP_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={leftHipX} y1={HIP_Y} x2={rightHipX} y2={HIP_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Left leg */}
        <line x1={leftHipX} y1={HIP_Y} x2={leftKneeX} y2={leftKneeY} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={leftKneeX} y1={leftKneeY} x2={leftFootX} y2={leftFootY} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Right leg */}
        <line x1={rightHipX} y1={HIP_Y} x2={rightKneeX} y2={rightKneeY} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={rightKneeX} y1={rightKneeY} x2={rightFootX} y2={rightFootY} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={leftHipX} cy={HIP_Y} r="3.2" />
          <circle cx={rightHipX} cy={HIP_Y} r="3.2" />
          <circle cx={leftKneeX} cy={leftKneeY} r="3.2" />
          <circle cx={rightKneeX} cy={rightKneeY} r="3.2" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
