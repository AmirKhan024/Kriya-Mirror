'use client';
import { useId } from 'react';

/**
 * Reverse Lunge stickman — FRONT view, three variants:
 *   hero     — correct: front knee bent ~90°, rear knee dropped behind, torso tall
 *   bottom   — alias of hero (used by the steps array)
 *   shallow  — wrong: barely bent, standing too tall
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx).
 * Glow filter uses filterUnits="userSpaceOnUse" with an explicit region.
 */
type Variant = 'hero' | 'bottom' | 'shallow';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function ReverseLungeSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `rl-glow-${uid}`;
  const floorId = `rl-floor-${uid}`;

  const CX = 180;
  const SHOULDER_Y = 64;
  const HIP_Y = variant === 'shallow' ? 108 : 120; // hips lower when lunging deep
  const FLOOR_Y = 188;
  const hipHalf = 16;
  const shoulderHalf = 28;

  // Front (planted) leg — screen-left. Knee bent: knee forward & down, shin vertical-ish.
  const frontHipX = CX - hipHalf;
  const deep = variant !== 'shallow';
  const frontKneeX = frontHipX - (deep ? 30 : 10);
  const frontKneeY = deep ? HIP_Y + 34 : HIP_Y + 48;
  const frontAnkleX = frontKneeX - 4;
  const frontAnkleY = FLOOR_Y;

  // Rear leg — screen-right, stepped back, knee dropped toward floor.
  const rearHipX = CX + hipHalf;
  const rearKneeX = rearHipX + (deep ? 24 : 8);
  const rearKneeY = deep ? HIP_Y + 40 : HIP_Y + 50;
  const rearAnkleX = rearKneeX + 18;
  const rearAnkleY = FLOOR_Y - (deep ? 6 : 0);

  const bodyColor = variant === 'shallow' ? AMBER : TEAL;

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
        <ellipse cx="190" cy={FLOOR_Y + 4} rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="30" y1={FLOOR_Y + 4} x2="345" y2={FLOOR_Y + 4} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Torso (upright) */}
        <line x1={CX} y1={SHOULDER_Y} x2={CX} y2={HIP_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        {/* Shoulders */}
        <line x1={CX - shoulderHalf} y1={SHOULDER_Y} x2={CX + shoulderHalf} y2={SHOULDER_Y} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        {/* Hips */}
        <line x1={CX - hipHalf} y1={HIP_Y} x2={CX + hipHalf} y2={HIP_Y} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Front leg (bent) */}
        <line x1={frontHipX} y1={HIP_Y} x2={frontKneeX} y2={frontKneeY} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={frontKneeX} y1={frontKneeY} x2={frontAnkleX} y2={frontAnkleY} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Rear leg (stepped back, knee dropped) */}
        <line x1={rearHipX} y1={HIP_Y} x2={rearKneeX} y2={rearKneeY} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={rearKneeX} y1={rearKneeY} x2={rearAnkleX} y2={rearAnkleY} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms relaxed */}
        <line x1={CX - shoulderHalf} y1={SHOULDER_Y} x2={CX - shoulderHalf - 4} y2={SHOULDER_Y + 38} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={CX + shoulderHalf} y1={SHOULDER_Y} x2={CX + shoulderHalf + 4} y2={SHOULDER_Y + 38} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={CX} cy={SHOULDER_Y - 22} r="14" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={frontHipX} cy={HIP_Y} r="3.5" />
          <circle cx={frontKneeX} cy={frontKneeY} r="3.5" />
          <circle cx={rearKneeX} cy={rearKneeY} r="3.5" />
        </g>

        {variant === 'shallow' && (
          <text x="180" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Lower deeper
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
