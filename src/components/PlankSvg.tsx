'use client';
import { useId } from 'react';

/**
 * Plank stickman — side view, three variants:
 *   hero — correct: shoulder, hip, ankle all on one straight line
 *   sag  — hip drops below the line (wrong, danger)
 *   pike — hip rises above the line (wrong, amber)
 *
 * Body drawn as two individual <line> elements (shoulder→hip, hip→ankle).
 * NOT a polyline — collinear polyline points + filter can fail to render.
 * Each <line> is bulletproof regardless of whether the points are collinear.
 */
type Variant = 'hero' | 'sag' | 'pike';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const DANGER = '#FF4D6A';
const MUTED = '#5a6b80';

export function PlankSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `pl-glow-${uid}`;
  const floorId = `pl-floor-${uid}`;
  const arrowId = `pl-arrow-${uid}`;

  // Body anchors at y=100 (level). Hip drops/rises for sag/pike.
  const SHOULDER_X = 80, SHOULDER_Y = 100;
  const HIP_X = 190;
  const ANKLE_X = 300, ANKLE_Y = 100;
  const hipY = variant === 'sag' ? 130 : variant === 'pike' ? 75 : 100;
  const bodyColor = variant === 'sag' ? DANGER : variant === 'pike' ? AMBER : TEAL;

  return (
    <div className={className}>
      <svg viewBox="0 0 360 200" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          {/* filterUnits="userSpaceOnUse" with explicit region covering the
              whole viewbox — without this, horizontal lines (zero-height
              bounding box) get clipped to nothing by the default filter region. */}
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="400" height="240">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id={arrowId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={bodyColor} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="190" cy="170" rx="140" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="170" x2="340" y2="170" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference straight line (only for wrong-form variants) */}
        {variant !== 'hero' && (
          <line
            x1={SHOULDER_X} y1={SHOULDER_Y} x2={ANKLE_X} y2={ANKLE_Y}
            stroke={TEAL} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55"
          />
        )}

        {/* Body — TWO INDIVIDUAL LINES (not a polyline). Drawn before everything else
            so subsequent overlays (forearm/toes/joints) sit on top cleanly. */}
        <line
          x1={SHOULDER_X} y1={SHOULDER_Y} x2={HIP_X} y2={hipY}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={HIP_X} y1={hipY} x2={ANKLE_X} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Forearm — vertical from shoulder + horizontal on floor */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" fill="none" filter={`url(#${glowId})`}>
          <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={SHOULDER_X} y2="162" />
          <line x1={SHOULDER_X} y1="162" x2={SHOULDER_X + 38} y2="162" />
        </g>

        {/* Toes / foot */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" fill="none" filter={`url(#${glowId})`}>
          <line x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X + 8} y2="162" />
          <line x1={ANKLE_X + 4} y1="165" x2={ANKLE_X + 22} y2="165" />
        </g>

        {/* Head */}
        <circle
          cx={SHOULDER_X - 22} cy={SHOULDER_Y - 10} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5"
          filter={`url(#${glowId})`}
        />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={HIP_X} cy={hipY} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {/* Arrows + labels for wrong-form variants */}
        {variant === 'sag' && (
          <g>
            <path d={`M ${HIP_X} 100 L ${HIP_X} ${hipY - 6}`} stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x={HIP_X} y="190" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Hips sagging
            </text>
          </g>
        )}
        {variant === 'pike' && (
          <g>
            <path d={`M ${HIP_X} 100 L ${HIP_X} ${hipY + 6}`} stroke={AMBER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x={HIP_X} y="190" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
              Hips piked
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
