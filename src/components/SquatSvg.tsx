'use client';
import { useId } from 'react';

/**
 * Squat stickman — three phases.
 *   stand   : upright with arm forward (so the arm is clearly visible vs the spine)
 *   descend : mid-squat
 *   hero    : parallel depth — thighs horizontal
 *
 * Body is drawn as individual <line> segments (not a polyline) because
 * polylines with collinear points + linejoin="round" + filter can fail to
 * render in some browsers. Each segment as its own line is bulletproof.
 */
type Variant = 'stand' | 'descend' | 'hero';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

interface Pose {
  head: [number, number];
  shoulder: [number, number];
  hip: [number, number];
  knee: [number, number];
  ankle: [number, number];
  elbow: [number, number];
  wrist: [number, number];
}

// Viewbox 220 wide × 240 tall.
const POSES: Record<Variant, Pose> = {
  stand: {
    head:     [110, 35],
    shoulder: [110, 65],
    elbow:    [128, 100],
    wrist:    [138, 138],
    hip:      [110, 118],
    knee:     [110, 168],
    ankle:    [110, 213],
  },
  descend: {
    head:     [105, 55],
    shoulder: [108, 85],
    elbow:    [140, 100],
    wrist:    [170, 110],
    hip:      [92, 135],
    knee:     [125, 175],
    ankle:    [110, 213],
  },
  hero: {
    head:     [100, 75],
    shoulder: [108, 100],
    elbow:    [145, 118],
    wrist:    [180, 128],
    hip:      [85, 158],
    knee:     [125, 175],
    ankle:    [110, 213],
  },
};

export function SquatSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sq-glow-${uid}`;
  const floorId = `sq-floor-${uid}`;
  const p = POSES[variant];

  return (
    <div className={className}>
      <svg viewBox="0 0 220 240" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          {/* filterUnits="userSpaceOnUse" with explicit region covering the whole
              viewbox — required so horizontal/vertical lines (zero-height or
              zero-width bounding boxes) don't have their filter region collapse
              to zero, which would clip the rendered output entirely. */}
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="260" height="280">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Floor */}
        <ellipse cx="110" cy="221" rx="55" ry="5" fill={`url(#${floorId})`} />
        <line x1="20" y1="221" x2="200" y2="221" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Body — three individual lines, drawn before joints */}
        <g stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.hip[0]} y2={p.hip[1]} />
          <line x1={p.hip[0]} y1={p.hip[1]} x2={p.knee[0]} y2={p.knee[1]} />
          <line x1={p.knee[0]} y1={p.knee[1]} x2={p.ankle[0]} y2={p.ankle[1]} />
        </g>

        {/* Arm — two lines */}
        <g stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`} opacity="0.9">
          <line x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.elbow[0]} y2={p.elbow[1]} />
          <line x1={p.elbow[0]} y1={p.elbow[1]} x2={p.wrist[0]} y2={p.wrist[1]} />
        </g>

        {/* Foot */}
        <line
          x1={p.ankle[0] - 14} y1="220" x2={p.ankle[0] + 14} y2="220"
          stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Head */}
        <circle
          cx={p.head[0]} cy={p.head[1]} r="14"
          fill="none" stroke={TEAL} strokeWidth="3.5"
          filter={`url(#${glowId})`}
        />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={p.shoulder[0]} cy={p.shoulder[1]} r="3" />
          <circle cx={p.hip[0]} cy={p.hip[1]} r="3" />
          <circle cx={p.knee[0]} cy={p.knee[1]} r="3" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
