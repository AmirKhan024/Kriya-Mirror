'use client';
import { useId } from 'react';

/**
 * Standing Side Leg Raise stickman — FRONT view, three variants:
 *   hero     — correct: one leg lifted out to the side ~35°, torso upright
 *   up       — same as hero (alias used by the steps array)
 *   shallow  — wrong: leg barely lifted off the floor
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx).
 * Glow filter uses filterUnits="userSpaceOnUse" with an explicit region.
 */
type Variant = 'hero' | 'up' | 'shallow';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function SideLegRaiseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `slr-glow-${uid}`;
  const floorId = `slr-floor-${uid}`;
  const arrowId = `slr-arrow-${uid}`;

  // Front-view anchors. The user's LEFT leg (screen-left) abducts outward.
  const CX = 180;
  const HEAD_Y = 42;
  const SHOULDER_Y = 70;
  const HIP_Y = 116;
  const ANKLE_Y = 182;

  const shoulderHalf = 30;
  const hipHalf = 16;

  // Standing leg (screen-right): vertical.
  const standHipX = CX + hipHalf;
  const standKneeX = CX + hipHalf + 2;
  const standAnkleX = CX + hipHalf + 4;
  const standKneeY = (HIP_Y + ANKLE_Y) / 2;

  // Lifting leg (screen-left): abducted out to the side by `abdDeg`.
  const liftHipX = CX - hipHalf;
  const abdDeg = variant === 'shallow' ? 10 : 35;
  const legLen = ANKLE_Y - HIP_Y; // vertical leg length
  const theta = (abdDeg * Math.PI) / 180;
  const liftAnkleX = liftHipX - Math.sin(theta) * legLen;
  const liftAnkleY = HIP_Y + Math.cos(theta) * legLen;
  const liftKneeX = liftHipX - Math.sin(theta) * (legLen / 2);
  const liftKneeY = HIP_Y + Math.cos(theta) * (legLen / 2);

  const liftColor = variant === 'shallow' ? AMBER : TEAL;

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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={liftColor} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="190" cy="190" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="30" y1="190" x2="345" y2="190" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Torso */}
        <line
          x1={CX} y1={SHOULDER_Y} x2={CX} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`}
        />
        {/* Shoulders */}
        <line
          x1={CX - shoulderHalf} y1={SHOULDER_Y} x2={CX + shoulderHalf} y2={SHOULDER_Y}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />
        {/* Hips */}
        <line
          x1={CX - hipHalf} y1={HIP_Y} x2={CX + hipHalf} y2={HIP_Y}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Standing leg */}
        <line x1={standHipX} y1={HIP_Y} x2={standKneeX} y2={standKneeY} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={standKneeX} y1={standKneeY} x2={standAnkleX} y2={ANKLE_Y} stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Lifting leg (abducted) */}
        <line x1={liftHipX} y1={HIP_Y} x2={liftKneeX} y2={liftKneeY} stroke={liftColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={liftKneeX} y1={liftKneeY} x2={liftAnkleX} y2={liftAnkleY} stroke={liftColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms relaxed at sides */}
        <line x1={CX - shoulderHalf} y1={SHOULDER_Y} x2={CX - shoulderHalf - 4} y2={SHOULDER_Y + 40} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={CX + shoulderHalf} y1={SHOULDER_Y} x2={CX + shoulderHalf + 4} y2={SHOULDER_Y + 40} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={CX} cy={HEAD_Y} r="14" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={CX - hipHalf} cy={HIP_Y} r="3.5" />
          <circle cx={CX + hipHalf} cy={HIP_Y} r="3.5" />
          <circle cx={liftKneeX} cy={liftKneeY} r="3.5" />
          <circle cx={liftAnkleX} cy={liftAnkleY} r="3.5" />
        </g>

        {/* Abduction arc hint on the hero */}
        {variant !== 'shallow' && (
          <path
            d={`M ${liftHipX} ${HIP_Y + 40} A 40 40 0 0 1 ${liftHipX - Math.sin(theta) * 40} ${HIP_Y + Math.cos(theta) * 40}`}
            stroke={liftColor} strokeWidth="2" fill="none" strokeDasharray="3 3" markerEnd={`url(#${arrowId})`}
          />
        )}
        {variant === 'shallow' && (
          <text x="120" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Lift higher
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
