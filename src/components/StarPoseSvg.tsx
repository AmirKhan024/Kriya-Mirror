'use client';
import { useId } from 'react';

/**
 * Star Pose stickman — FRONT view. Balance on one leg, extend the other leg out
 * to the side and lift it, raise BOTH arms up and out → a star/asterisk shape.
 *   hero — the full star: right leg planted, left leg out-and-up, arms in a wide V.
 *
 * Mirrors JumpingJacksSvg conventions (individual <line>s, glow filter, floor,
 * joint dots, teal/amber palette).
 */
type Variant = 'hero';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function StarPoseSvg({ className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sp-glow-${uid}`;
  const floorId = `sp-floor-${uid}`;

  const MID_X = 180;
  const SHOULDER_Y = 72;
  const HIP_Y = 120;
  const FLOOR_Y = 182;

  const SHOULDER_HALF = 24;
  const LEFT_SHOULDER_X = MID_X - SHOULDER_HALF;
  const RIGHT_SHOULDER_X = MID_X + SHOULDER_HALF;
  const HIP_HALF = 14;
  const LEFT_HIP_X = MID_X - HIP_HALF;
  const RIGHT_HIP_X = MID_X + HIP_HALF;

  // Standing leg (right): planted, nearly vertical, foot on the floor.
  const STAND_KNEE_X = MID_X + 17, STAND_KNEE_Y = (HIP_Y + FLOOR_Y) / 2;
  const STAND_ANKLE_X = MID_X + 19, STAND_ANKLE_Y = FLOOR_Y;

  // Extended leg (left): out to the side and LIFTED off the floor (diagonal).
  const EXT_KNEE_X = MID_X - 48, EXT_KNEE_Y = 150;
  const EXT_ANKLE_X = MID_X - 84, EXT_ANKLE_Y = 132;

  // Arms: both raised up and OUT into a wide V.
  const LEFT_ELBOW_X = MID_X - 50, LEFT_ELBOW_Y = SHOULDER_Y - 18;
  const LEFT_WRIST_X = MID_X - 76, LEFT_WRIST_Y = SHOULDER_Y - 44;
  const RIGHT_ELBOW_X = MID_X + 50, RIGHT_ELBOW_Y = SHOULDER_Y - 18;
  const RIGHT_WRIST_X = MID_X + 76, RIGHT_WRIST_Y = SHOULDER_Y - 44;

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
        <ellipse cx={MID_X} cy={FLOOR_Y + 6} rx="140" ry="5" fill={`url(#${floorId})`} />
        <line x1="40" y1={FLOOR_Y + 5} x2="320" y2={FLOOR_Y + 5} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Torso — shoulder line + spine + hip line */}
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={RIGHT_SHOULDER_X} y2={SHOULDER_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={SHOULDER_Y} x2={MID_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_HIP_X} y1={HIP_Y} x2={RIGHT_HIP_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Standing leg (right) — hip → knee → ankle on the floor */}
        <line x1={RIGHT_HIP_X} y1={HIP_Y} x2={STAND_KNEE_X} y2={STAND_KNEE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={STAND_KNEE_X} y1={STAND_KNEE_Y} x2={STAND_ANKLE_X} y2={STAND_ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={STAND_ANKLE_X} y1={STAND_ANKLE_Y} x2={STAND_ANKLE_X + 16} y2={STAND_ANKLE_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Extended leg (left) — hip → knee → LIFTED ankle out to the side */}
        <line x1={LEFT_HIP_X} y1={HIP_Y} x2={EXT_KNEE_X} y2={EXT_KNEE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={EXT_KNEE_X} y1={EXT_KNEE_Y} x2={EXT_ANKLE_X} y2={EXT_ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms — shoulder → elbow → wrist, raised up and out (wide V) */}
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={LEFT_ELBOW_X} y2={LEFT_ELBOW_Y}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_ELBOW_X} y1={LEFT_ELBOW_Y} x2={LEFT_WRIST_X} y2={LEFT_WRIST_Y}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_SHOULDER_X} y1={SHOULDER_Y} x2={RIGHT_ELBOW_X} y2={RIGHT_ELBOW_Y}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_ELBOW_X} y1={RIGHT_ELBOW_Y} x2={RIGHT_WRIST_X} y2={RIGHT_WRIST_Y}
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
          <circle cx={LEFT_ELBOW_X} cy={LEFT_ELBOW_Y} r="3" />
          <circle cx={RIGHT_ELBOW_X} cy={RIGHT_ELBOW_Y} r="3" />
          <circle cx={LEFT_WRIST_X} cy={LEFT_WRIST_Y} r="3" />
          <circle cx={RIGHT_WRIST_X} cy={RIGHT_WRIST_Y} r="3" />
          <circle cx={STAND_ANKLE_X} cy={STAND_ANKLE_Y} r="3" />
          <circle cx={EXT_ANKLE_X} cy={EXT_ANKLE_Y} r="3" />
          <circle cx={EXT_KNEE_X} cy={EXT_KNEE_Y} r="3" />
          <circle cx={STAND_KNEE_X} cy={STAND_KNEE_Y} r="3" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
