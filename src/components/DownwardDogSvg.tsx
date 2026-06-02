'use client';
import { useId } from 'react';

/**
 * Downward Dog (Adho Mukha Svanasana) stickman — side view, two variants:
 *   hero — correct: hips lifted high into a sharp inverted V, arms + legs long
 *   sag  — wrong: hips dropped, the V flattening toward a plank line
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx for
 * the bug that motivated this). Glow filter uses filterUnits="userSpaceOnUse"
 * with an explicit region so near-horizontal lines don't get clipped.
 */
type Variant = 'hero' | 'sag';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function DownwardDogSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `dd-glow-${uid}`;
  const floorId = `dd-floor-${uid}`;

  // Hands forward (right of frame), feet back (left). Hip is the apex; the
  // sag variant drops the hip so the inverted V flattens.
  const HIP_X = 185;
  const HIP_Y = variant === 'sag' ? 112 : 72;

  // Arm side (hip → shoulder → wrist), reaching down-forward to the floor.
  const SHOULDER_X = 232, SHOULDER_Y = 120;
  const WRIST_X = 272, WRIST_Y = 164;
  // Leg side (hip → knee → ankle), reaching down-back to the floor.
  const KNEE_X = 138, KNEE_Y = 120;
  const ANKLE_X = 98, ANKLE_Y = 164;

  const bodyColor = variant === 'sag' ? AMBER : TEAL;

  // Head hangs between the arms, just beyond the shoulder.
  const HEAD_X = SHOULDER_X + 16;
  const HEAD_Y = SHOULDER_Y + 14;

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
        <ellipse cx="185" cy="174" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="174" x2="350" y2="174" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference apex for the sag variant */}
        {variant === 'sag' && (
          <g opacity="0.55">
            <circle cx={HIP_X} cy={72} r="5" fill="none" stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={HIP_X} y={60} fontSize="9" fill={TEAL} textAnchor="middle">lift hips here</text>
          </g>
        )}

        {/* Legs — hip → knee → ankle */}
        <line x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={ANKLE_X} y2={ANKLE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Torso + arm — hip → shoulder → wrist */}
        <line x1={HIP_X} y1={HIP_Y} x2={SHOULDER_X} y2={SHOULDER_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={WRIST_X} y2={WRIST_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Hand + foot */}
        <line x1={WRIST_X} y1={WRIST_Y} x2={WRIST_X + 16} y2={WRIST_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X - 16} y2={ANKLE_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head — hanging between the arms */}
        <circle cx={HEAD_X} cy={HEAD_Y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {variant === 'sag' && (
          <text x="185" y="194" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Lift your hips — don&apos;t let them sag
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
