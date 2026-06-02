'use client';
import { useId } from 'react';

/**
 * Standing Oblique Side Bend stickman — FRONT view, three variants:
 *   hero     — correct: torso bent ~28° to the side, hips level, reaching down
 *   bent     — alias of hero (used by the steps array)
 *   shallow  — wrong: barely leaning off vertical
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx).
 * Glow filter uses filterUnits="userSpaceOnUse" with an explicit region.
 */
type Variant = 'hero' | 'bent' | 'shallow';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function ObliqueSideBendSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `osb-glow-${uid}`;
  const floorId = `osb-floor-${uid}`;

  const CX = 180;
  const HIP_Y = 120;
  const ANKLE_Y = 186;
  const hipHalf = 16;
  const shoulderHalf = 28;
  const torsoLen = 50;

  // Torso bends to the user's screen-right by `leanDeg`.
  const leanDeg = variant === 'shallow' ? 6 : 28;
  const theta = (leanDeg * Math.PI) / 180;
  const shoulderMidX = CX + Math.sin(theta) * torsoLen;
  const shoulderMidY = HIP_Y - Math.cos(theta) * torsoLen;

  const torsoColor = variant === 'shallow' ? AMBER : TEAL;

  // Legs vertical, feet under hips.
  const kneeY = (HIP_Y + ANKLE_Y) / 2;

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
        <ellipse cx="190" cy="194" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="30" y1="194" x2="345" y2="194" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Vertical reference through the hips (shows the lean) */}
        <line x1={CX} y1={HIP_Y} x2={CX} y2={HIP_Y - torsoLen} stroke={MUTED} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.55" />

        {/* Torso (hipMid → shoulderMid) */}
        <line
          x1={CX} y1={HIP_Y} x2={shoulderMidX} y2={shoulderMidY}
          stroke={torsoColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`}
        />
        {/* Shoulders (tilted with the bend) */}
        <line
          x1={shoulderMidX - shoulderHalf} y1={shoulderMidY + Math.sin(theta) * shoulderHalf}
          x2={shoulderMidX + shoulderHalf} y2={shoulderMidY - Math.sin(theta) * shoulderHalf}
          stroke={torsoColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />
        {/* Hips (level) */}
        <line
          x1={CX - hipHalf} y1={HIP_Y} x2={CX + hipHalf} y2={HIP_Y}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Legs (vertical) */}
        <line x1={CX - hipHalf} y1={HIP_Y} x2={CX - hipHalf} y2={kneeY} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={CX - hipHalf} y1={kneeY} x2={CX - hipHalf} y2={ANKLE_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={CX + hipHalf} y1={HIP_Y} x2={CX + hipHalf} y2={kneeY} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={CX + hipHalf} y1={kneeY} x2={CX + hipHalf} y2={ANKLE_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Bending-side arm reaching down toward the thigh */}
        <line
          x1={shoulderMidX + shoulderHalf} y1={shoulderMidY - Math.sin(theta) * shoulderHalf}
          x2={CX + hipHalf + 6} y2={kneeY - 8}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Head */}
        <circle cx={shoulderMidX} cy={shoulderMidY - 20} r="13" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={shoulderMidX} cy={shoulderMidY} r="3.5" />
          <circle cx={CX} cy={HIP_Y} r="3.5" />
        </g>

        {variant === 'shallow' && (
          <text x="180" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Bend further
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
