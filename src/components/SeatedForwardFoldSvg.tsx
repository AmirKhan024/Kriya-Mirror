'use client';
import { useId } from 'react';

/**
 * Seated Forward Fold (Paschimottanasana) stickman — side view, two variants:
 *   hero    — correct: long-sitting, torso folded forward over the extended legs
 *   shallow — wrong: sitting upright, not folding forward
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx for
 * the bug that motivated this). Glow filter uses filterUnits="userSpaceOnUse"
 * with an explicit region so near-horizontal lines don't get clipped.
 */
type Variant = 'hero' | 'shallow';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function SeatedForwardFoldSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sff-glow-${uid}`;
  const floorId = `sff-floor-${uid}`;

  const FLOOR_Y = 158;
  // Hip sits on the floor at the back; legs extend forward (right) along the floor.
  const HIP_X = 108, HIP_Y = FLOOR_Y - 4;
  const KNEE_X = 188, KNEE_Y = FLOOR_Y - 2;
  const ANKLE_X = 262, ANKLE_Y = FLOOR_Y - 2;

  // Torso hinges up/forward from the hip. Hero folds deep (shoulder forward,
  // low, over the thighs); shallow sits upright (shoulder high above the hip).
  const SHOULDER_X = variant === 'hero' ? 168 : 128;
  const SHOULDER_Y = variant === 'hero' ? 132 : 98;

  const bodyColor = variant === 'hero' ? TEAL : AMBER;

  // Head beyond the shoulder along the fold direction.
  const HEAD_X = SHOULDER_X + (variant === 'hero' ? 16 : 4);
  const HEAD_Y = SHOULDER_Y + (variant === 'hero' ? 8 : -16);

  // Arm reaches from the shoulder toward the shins/feet.
  const WRIST_X = variant === 'hero' ? 214 : 150;
  const WRIST_Y = variant === 'hero' ? 150 : 132;

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
        <ellipse cx="185" cy={FLOOR_Y + 6} rx="165" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1={FLOOR_Y + 4} x2="345" y2={FLOOR_Y + 4} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference: folded torso for the shallow variant */}
        {variant === 'shallow' && (
          <g opacity="0.5">
            <circle cx={184} cy={140} r="5" fill="none" stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={196} y={138} fontSize="9" fill={TEAL} textAnchor="start">fold forward</text>
          </g>
        )}

        {/* Legs — hip → knee → ankle (along the floor) */}
        <line x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={ANKLE_X} y2={ANKLE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Torso — hip → shoulder (the fold) */}
        <line x1={HIP_X} y1={HIP_Y} x2={SHOULDER_X} y2={SHOULDER_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arm — shoulder → wrist (reaching toward the feet) */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={WRIST_X} y2={WRIST_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Foot */}
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X} y2={ANKLE_Y - 16} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={HEAD_X} cy={HEAD_Y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {variant === 'shallow' && (
          <text x="185" y="192" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Fold forward over your legs
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
