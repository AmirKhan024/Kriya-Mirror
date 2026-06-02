'use client';
import { useId } from 'react';

/**
 * Boat Pose stickman — side-on "V" view, two variants:
 *   hero      — correct: balanced on the sit bones, torso lifted up-and-back,
 *               legs lifted up-and-forward (the V), arms reaching forward
 *   legs-down — wrong: legs sagging toward the floor (the V collapsing)
 *
 * Each limb is an individual <line> (no polyline — see PlankSvg).
 */
type Variant = 'hero' | 'legs-down';

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

export function BoatPoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `bp-glow-${uid}`;
  const floorId = `bp-floor-${uid}`;

  // Hip (sit bone) is the vertex of the V, on the floor.
  const HIP = { x: 178, y: 150 };
  // Torso reaches up-and-back (left).
  const SHOULDER = { x: 128, y: 96 };
  const HEAD = { x: 112, y: 80 };
  // Legs reach up-and-forward (right) — or sag toward the floor (wrong).
  const legsDown = variant === 'legs-down';
  const KNEE = legsDown ? { x: 232, y: 150 } : { x: 232, y: 116 };
  const ANKLE = legsDown ? { x: 280, y: 158 } : { x: 280, y: 90 };
  // Arms reach forward, parallel to the legs.
  const ELBOW = { x: 175, y: 116 };
  const WRIST = { x: 224, y: 120 };

  const legColor = legsDown ? DANGER : TEAL;

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
        <ellipse cx="185" cy="166" rx="120" ry="5" fill={`url(#${floorId})`} />
        <line x1="50" y1="166" x2="320" y2="166" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Torso (hip → shoulder, up-and-back) */}
        <line x1={HIP.x} y1={HIP.y} x2={SHOULDER.x} y2={SHOULDER.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Legs (hip → knee → ankle, up-and-forward) */}
        <line x1={HIP.x} y1={HIP.y} x2={KNEE.x} y2={KNEE.y}
          stroke={legColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE.x} y1={KNEE.y} x2={ANKLE.x} y2={ANKLE.y}
          stroke={legColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms reaching forward */}
        <line x1={SHOULDER.x} y1={SHOULDER.y} x2={ELBOW.x} y2={ELBOW.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={ELBOW.x} y1={ELBOW.y} x2={WRIST.x} y2={WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={HEAD.x} cy={HEAD.y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={HIP.x} cy={HIP.y} r="3.5" />
          <circle cx={SHOULDER.x} cy={SHOULDER.y} r="3.5" />
          <circle cx={KNEE.x} cy={KNEE.y} r="3.5" />
          <circle cx={ANKLE.x} cy={ANKLE.y} r="3.5" />
          <circle cx={WRIST.x} cy={WRIST.y} r="3.5" />
        </g>

        {variant === 'legs-down' && (
          <text x="180" y="190" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
            Lift your legs into the V
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
