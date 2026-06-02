'use client';
import { useId } from 'react';

/**
 * Side Plank stickman — silhouette view, two variants:
 *   hero — correct: body one straight line from head to feet, propped on the
 *          bottom forearm, hips lifted, top arm reaching up
 *   sag  — wrong: hips dropped below the head-to-feet line
 *
 * Each limb is an individual <line> (no polyline — see PlankSvg).
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
const DANGER = '#FF4D6A';
const MUTED = '#5a6b80';

export function SidePlankSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sp-glow-${uid}`;
  const floorId = `sp-floor-${uid}`;

  // Diagonal body line: head top-left, feet bottom-right on the floor.
  const SHOULDER = { x: 130, y: 105 };
  const HEAD = { x: 110, y: 90 };
  const ANKLE = { x: 280, y: 162 };
  // Hip on the shoulder→ankle line (hero) or dropped below it (sag).
  const sag = variant === 'sag';
  const HIP = { x: 205, y: sag ? 162 : 134 };
  const KNEE = { x: 243, y: sag ? 165 : 148 };

  // Support forearm: shoulder down to the elbow on the floor.
  const ELBOW = { x: 130, y: 165 };
  // Top arm reaches straight up.
  const TOP_ELBOW = { x: 132, y: 72 };
  const TOP_WRIST = { x: 134, y: 40 };

  const bodyColor = sag ? DANGER : TEAL;

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
        <ellipse cx="190" cy="172" rx="130" ry="5" fill={`url(#${floorId})`} />
        <line x1="40" y1="172" x2="320" y2="172" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Body line: shoulder → hip → knee → ankle */}
        <line x1={SHOULDER.x} y1={SHOULDER.y} x2={HIP.x} y2={HIP.y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={HIP.x} y1={HIP.y} x2={KNEE.x} y2={KNEE.y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE.x} y1={KNEE.y} x2={ANKLE.x} y2={ANKLE.y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Support forearm (shoulder → elbow on floor) */}
        <line x1={SHOULDER.x} y1={SHOULDER.y} x2={ELBOW.x} y2={ELBOW.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Top arm reaching up */}
        <line x1={SHOULDER.x} y1={SHOULDER.y} x2={TOP_ELBOW.x} y2={TOP_ELBOW.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={TOP_ELBOW.x} y1={TOP_ELBOW.y} x2={TOP_WRIST.x} y2={TOP_WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={HEAD.x} cy={HEAD.y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER.x} cy={SHOULDER.y} r="3.5" />
          <circle cx={HIP.x} cy={HIP.y} r="3.5" />
          <circle cx={KNEE.x} cy={KNEE.y} r="3.5" />
          <circle cx={ANKLE.x} cy={ANKLE.y} r="3.5" />
          <circle cx={ELBOW.x} cy={ELBOW.y} r="3.5" />
          <circle cx={TOP_WRIST.x} cy={TOP_WRIST.y} r="3.5" />
        </g>

        {variant === 'sag' && (
          <text x="200" y="194" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
            Lift your hips into one line
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
