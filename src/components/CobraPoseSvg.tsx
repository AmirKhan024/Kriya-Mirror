'use client';
import { useId } from 'react';

/**
 * Cobra Pose (Bhujangasana) stickman — side view, two variants:
 *   hero — correct: lying prone, chest lifted off the floor, hips grounded
 *   flat — wrong: chest dropped to the floor (not lifted)
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx for
 * the bug that motivated this). Glow filter uses filterUnits="userSpaceOnUse"
 * with an explicit region so near-horizontal lines don't get clipped.
 */
type Variant = 'hero' | 'flat';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function CobraPoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `cb-glow-${uid}`;
  const floorId = `cb-floor-${uid}`;

  const FLOOR_Y = 160;
  // Lower body lies flat along the floor (head to the right).
  const ANKLE_X = 60, ANKLE_Y = FLOOR_Y - 2;
  const KNEE_X = 132, KNEE_Y = FLOOR_Y - 2;
  const HIP_X = 202, HIP_Y = FLOOR_Y - 4;

  // Torso lifts forward-and-up from the hip; the flat variant barely rises.
  const SHOULDER_X = 262;
  const SHOULDER_Y = variant === 'hero' ? 116 : 150;

  const bodyColor = variant === 'hero' ? TEAL : AMBER;

  // Head just forward and up of the shoulder.
  const HEAD_X = SHOULDER_X + 22;
  const HEAD_Y = SHOULDER_Y - 8;

  // Hands planted under the shoulder on the floor; elbow bent.
  const WRIST_X = SHOULDER_X - 6, WRIST_Y = FLOOR_Y - 2;
  const ELBOW_X = SHOULDER_X - 2, ELBOW_Y = (SHOULDER_Y + WRIST_Y) / 2;

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
        <ellipse cx="185" cy={FLOOR_Y + 6} rx="160" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1={FLOOR_Y + 4} x2="345" y2={FLOOR_Y + 4} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference: lifted-chest position for the flat variant */}
        {variant === 'flat' && (
          <g opacity="0.55">
            <circle cx={SHOULDER_X} cy={116} r="5" fill="none" stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={SHOULDER_X + 12} y={110} fontSize="9" fill={TEAL} textAnchor="start">lift chest</text>
          </g>
        )}

        {/* Legs — ankle → knee → hip (along the floor) */}
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={KNEE_X} y2={KNEE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={HIP_X} y2={HIP_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Torso — hip → shoulder (the lift) */}
        <line x1={HIP_X} y1={HIP_Y} x2={SHOULDER_X} y2={SHOULDER_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arm — shoulder → elbow → wrist (hands planted on the floor) */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={ELBOW_X} y2={ELBOW_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={ELBOW_X} y1={ELBOW_Y} x2={WRIST_X} y2={WRIST_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Foot */}
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X - 16} y2={ANKLE_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={HEAD_X} cy={HEAD_Y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {variant === 'flat' && (
          <text x="185" y="192" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Lift your chest off the floor
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
