'use client';
import { useId } from 'react';

/**
 * 2026-05-28 round 22: Calf Raise re-architected from rep cycles to a static
 * HOLD. Stickman side view shows the iconic "heels up, balls of feet" pose:
 *   hero / top / up — heels well off the floor, on the balls of the feet
 *                     (the canonical pose the user holds for the target duration)
 *   down            — flat-foot reference (calibration pose, before the rise)
 *   mid             — half-raised (legacy step-illustration intermediate)
 *
 * Side view shows the heel→ankle rise unambiguously (the front view used at
 * runtime by the engine wouldn't read clearly in a 360×200 SVG). The toe
 * (ball of foot) stays pinned to the floor as the pivot; the heel, ankle,
 * and whole body lift together.
 */
type Variant = 'hero' | 'down' | 'mid' | 'top' | 'up';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function CalfRaiseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `cr-glow-${uid}`;
  const floorId = `cr-floor-${uid}`;
  const arrowId = `cr-arrow-${uid}`;

  // Hero / up are aliases for the iconic top-of-rise pose.
  const effective = variant === 'hero' || variant === 'up' ? 'top' : variant;

  // Heel rise in viewBox units. Toe stays on floor; ankle + body lift by `rise`.
  const rise = effective === 'top' ? 16 : effective === 'mid' ? 8 : 0;

  const FLOOR_Y = 178;
  const TOE_X = 218;
  const TOE_Y = FLOOR_Y;

  const ANKLE_X = 200;
  const ANKLE_Y = 168 - rise;     // ankle joint above the foot
  const HEEL_X = 192;
  const HEEL_Y = FLOOR_Y - rise;  // heel lifts off the floor as rise grows

  const KNEE_X = ANKLE_X;
  const KNEE_Y = 128 - rise;
  const HIP_X = ANKLE_X;
  const HIP_Y = 88 - rise;
  const SHOULDER_X = ANKLE_X;
  const SHOULDER_Y = 50 - rise;

  // Arms hang at sides — one arm visible from the side (the other overlaps
  // behind it). Straight-down forearm.
  const ELBOW_X = SHOULDER_X + 10;
  const ELBOW_Y = SHOULDER_Y + 28;
  const WRIST_X = ELBOW_X;
  const WRIST_Y = ELBOW_Y + 28;

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
          <marker id={arrowId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={TEAL} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="200" cy={FLOOR_Y} rx="140" ry="5" fill={`url(#${floorId})`} />
        <line x1="40" y1={FLOOR_Y} x2="320" y2={FLOOR_Y} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference heel-floor line for variants showing partial rise */}
        {effective !== 'down' && (
          <line x1={HEEL_X - 4} y1={FLOOR_Y} x2={HEEL_X + 4} y2={FLOOR_Y}
            stroke={AMBER} strokeWidth="1.2" opacity="0.7" />
        )}

        {/* Body — shoulder → hip → knee → ankle, straight vertical */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={HIP_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={ANKLE_X} y2={ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Foot — heel→ankle→toe in two segments. Toe stays pinned to floor;
            heel rises off the floor as `rise` grows. */}
        <line x1={HEEL_X} y1={HEEL_Y} x2={ANKLE_X} y2={ANKLE_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={TOE_X} y2={TOE_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arm — one side visible (the other overlaps behind in side view) */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={ELBOW_X} y2={ELBOW_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={ELBOW_X} y1={ELBOW_Y} x2={WRIST_X} y2={WRIST_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={SHOULDER_X} cy={SHOULDER_Y - 22} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
          <circle cx={HEEL_X} cy={HEEL_Y} r="3" />
          <circle cx={TOE_X} cy={TOE_Y} r="3" />
          <circle cx={ELBOW_X} cy={ELBOW_Y} r="3.5" />
        </g>

        {/* Heel-rise indicator on the top variants */}
        {effective === 'top' && rise > 0 && (
          <g>
            <path d={`M ${HEEL_X - 14} ${FLOOR_Y - 2} L ${HEEL_X - 14} ${HEEL_Y + 2}`}
              stroke={TEAL} strokeWidth="1.5" fill="none" markerEnd={`url(#${arrowId})`} opacity="0.85" />
            <text x={HEEL_X - 22} y={(FLOOR_Y + HEEL_Y) / 2 + 4}
              fontSize="10" fill={TEAL} textAnchor="end" fontWeight="600">
              rise
            </text>
          </g>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
