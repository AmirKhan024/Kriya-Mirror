'use client';
import { useId } from 'react';

/**
 * Mountain Pose stickman — front view, two variants:
 *   hero    — correct: standing tall, shoulders level, hips level, spine vertical,
 *             arms reaching overhead toward the ceiling
 *   tilted  — wrong: shoulders/hips uneven, spine off-vertical (arms still overhead)
 */
type Variant = 'hero' | 'tilted';

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

export function MountainPoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `mp-glow-${uid}`;
  const floorId = `mp-floor-${uid}`;
  const arrowId = `mp-arrow-${uid}`;

  // Vertical chain — front-facing standing pose, feet hip-width.
  const MID_X = 180;
  const SHOULDER_Y = 60;
  const HIP_Y = 120;
  const ANKLE_Y = 180;

  // Tilted variant: shift the right shoulder down + right hip up to simulate
  // uneven alignment.
  const tilt = variant === 'tilted' ? 12 : 0;

  const LEFT_SHOULDER = { x: MID_X - 24, y: SHOULDER_Y };
  const RIGHT_SHOULDER = { x: MID_X + 24, y: SHOULDER_Y + tilt };
  const LEFT_HIP = { x: MID_X - 14, y: HIP_Y - tilt };
  const RIGHT_HIP = { x: MID_X + 14, y: HIP_Y };
  const LEFT_KNEE = { x: MID_X - 14, y: (HIP_Y + ANKLE_Y) / 2 - tilt / 2 };
  const RIGHT_KNEE = { x: MID_X + 14, y: (HIP_Y + ANKLE_Y) / 2 };
  const LEFT_ANKLE = { x: MID_X - 14, y: ANKLE_Y };
  const RIGHT_ANKLE = { x: MID_X + 14, y: ANKLE_Y };

  // Arms reaching OVERHEAD toward the ceiling — slightly outward at the elbow,
  // then angling back inward at the wrist so the hands meet near the midline
  // above the head (the classic Tadasana-with-overhead-reach silhouette).
  const LEFT_ELBOW = { x: LEFT_SHOULDER.x - 6, y: SHOULDER_Y - 32 };
  const RIGHT_ELBOW = { x: RIGHT_SHOULDER.x + 6, y: RIGHT_SHOULDER.y - 32 };
  const LEFT_WRIST = { x: LEFT_ELBOW.x + 8, y: LEFT_ELBOW.y - 34 };
  const RIGHT_WRIST = { x: RIGHT_ELBOW.x - 8, y: RIGHT_ELBOW.y - 34 };

  const lineColor = variant === 'tilted' ? DANGER : TEAL;

  return (
    <div className={className}>
      <svg viewBox="0 -60 360 260" className="w-full h-auto">
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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DANGER} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx={MID_X} cy={ANKLE_Y + 6} rx="100" ry="5" fill={`url(#${floorId})`} />
        <line x1="80" y1={ANKLE_Y + 6} x2="280" y2={ANKLE_Y + 6} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference vertical for tilted variant */}
        {variant === 'tilted' && (
          <line x1={MID_X} y1={40} x2={MID_X} y2={ANKLE_Y + 4}
            stroke={TEAL} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55" />
        )}

        {/* Shoulder line */}
        <line x1={LEFT_SHOULDER.x} y1={LEFT_SHOULDER.y} x2={RIGHT_SHOULDER.x} y2={RIGHT_SHOULDER.y}
          stroke={lineColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        {/* Hip line */}
        <line x1={LEFT_HIP.x} y1={LEFT_HIP.y} x2={RIGHT_HIP.x} y2={RIGHT_HIP.y}
          stroke={lineColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        {/* Spine */}
        <line x1={(LEFT_SHOULDER.x + RIGHT_SHOULDER.x) / 2} y1={(LEFT_SHOULDER.y + RIGHT_SHOULDER.y) / 2}
          x2={(LEFT_HIP.x + RIGHT_HIP.x) / 2} y2={(LEFT_HIP.y + RIGHT_HIP.y) / 2}
          stroke={lineColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Legs */}
        <line x1={LEFT_HIP.x} y1={LEFT_HIP.y} x2={LEFT_KNEE.x} y2={LEFT_KNEE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_KNEE.x} y1={LEFT_KNEE.y} x2={LEFT_ANKLE.x} y2={LEFT_ANKLE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_HIP.x} y1={RIGHT_HIP.y} x2={RIGHT_KNEE.x} y2={RIGHT_KNEE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_KNEE.x} y1={RIGHT_KNEE.y} x2={RIGHT_ANKLE.x} y2={RIGHT_ANKLE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms hanging at sides */}
        <line x1={LEFT_SHOULDER.x} y1={LEFT_SHOULDER.y} x2={LEFT_ELBOW.x} y2={LEFT_ELBOW.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_ELBOW.x} y1={LEFT_ELBOW.y} x2={LEFT_WRIST.x} y2={LEFT_WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_SHOULDER.x} y1={RIGHT_SHOULDER.y} x2={RIGHT_ELBOW.x} y2={RIGHT_ELBOW.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_ELBOW.x} y1={RIGHT_ELBOW.y} x2={RIGHT_WRIST.x} y2={RIGHT_WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={(LEFT_SHOULDER.x + RIGHT_SHOULDER.x) / 2} cy={SHOULDER_Y - 22} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_SHOULDER.x} cy={LEFT_SHOULDER.y} r="3.5" />
          <circle cx={RIGHT_SHOULDER.x} cy={RIGHT_SHOULDER.y} r="3.5" />
          <circle cx={LEFT_HIP.x} cy={LEFT_HIP.y} r="3.5" />
          <circle cx={RIGHT_HIP.x} cy={RIGHT_HIP.y} r="3.5" />
          <circle cx={LEFT_KNEE.x} cy={LEFT_KNEE.y} r="3.5" />
          <circle cx={RIGHT_KNEE.x} cy={RIGHT_KNEE.y} r="3.5" />
          <circle cx={LEFT_ANKLE.x} cy={LEFT_ANKLE.y} r="3.5" />
          <circle cx={RIGHT_ANKLE.x} cy={RIGHT_ANKLE.y} r="3.5" />
        </g>

        {/* Wrong-form annotation */}
        {variant === 'tilted' && (
          <g>
            <path d={`M ${RIGHT_SHOULDER.x + 10} ${SHOULDER_Y} L ${RIGHT_SHOULDER.x + 10} ${RIGHT_SHOULDER.y - 4}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Shoulders uneven
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
