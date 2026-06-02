'use client';
import { useId } from 'react';

/**
 * Forward Lunge stickman — front view (camera-facing).
 *   stand   : upright, both legs straight (calibration pose)
 *   mid     : mid-rep — front knee bends, back leg extending behind
 *   hero    : bottom — front knee ~90°, back knee dropping toward floor
 *   bottom  : alias for hero
 *
 * Body drawn as individual <line> segments (NEVER polyline — B5).
 * Every <filter> uses filterUnits="userSpaceOnUse" + explicit region (B3) and
 * unique IDs derived from useId() (B4). Brand tokens only — no hex literals
 * in className (B6).
 *
 * In a real 2D front-view of a forward lunge, the leg that has stepped forward
 * appears at the user's stance width with hip dropped + knee bent + ankle
 * roughly under hip. The back leg is stretched out behind (depth axis) — its
 * 2D projection has the hip dropped + ankle still at floor + knee dropped
 * toward the floor (since 3D depth foreshortens to 2D drop).
 */
type Variant = 'stand' | 'mid' | 'hero' | 'bottom';

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
  /** Front leg (the one bending) — left side of figure, viewer's left. */
  frontKnee: [number, number];
  frontAnkle: [number, number];
  /** Back leg — right side of figure. */
  backKnee: [number, number];
  backAnkle: [number, number];
}

// viewBox 220 × 240. Centerline at x=110. Both ankles at y=213 (floor).
const POSES: Record<Variant, Pose> = {
  stand: {
    head:       [110, 30],
    shoulder:   [110, 60],
    hip:        [110, 115],
    frontKnee:  [100, 165],
    frontAnkle: [100, 213],
    backKnee:   [120, 165],
    backAnkle:  [120, 213],
  },
  mid: {
    head:       [110, 50],
    shoulder:   [110, 80],
    hip:        [105, 130],
    frontKnee:  [83, 168],
    frontAnkle: [95, 213],
    backKnee:   [128, 170],
    backAnkle:  [125, 213],
  },
  hero: {
    head:       [110, 70],
    shoulder:   [110, 100],
    hip:        [102, 150],
    frontKnee:  [76, 175],
    frontAnkle: [92, 213],
    backKnee:   [135, 195],
    backAnkle:  [130, 213],
  },
  bottom: {
    head:       [110, 70],
    shoulder:   [110, 100],
    hip:        [102, 150],
    frontKnee:  [76, 175],
    frontAnkle: [92, 213],
    backKnee:   [135, 195],
    backAnkle:  [130, 213],
  },
};

export function LungeSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `lu-glow-${uid}`;
  const floorId = `lu-floor-${uid}`;
  const p = POSES[variant];

  return (
    <div className={className}>
      <svg viewBox="0 0 220 240" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="260" height="280">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Floor */}
        <ellipse cx="110" cy="221" rx="80" ry="5" fill={`url(#${floorId})`} />
        <line x1="20" y1="221" x2="200" y2="221" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Torso */}
        <line
          x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.hip[0]} y2={p.hip[1]}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Front leg — hip → knee → ankle (two individual lines) */}
        <line
          x1={p.hip[0]} y1={p.hip[1]} x2={p.frontKnee[0]} y2={p.frontKnee[1]}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />
        <line
          x1={p.frontKnee[0]} y1={p.frontKnee[1]} x2={p.frontAnkle[0]} y2={p.frontAnkle[1]}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Back leg — slightly thinner/less prominent so the front leg reads as the active one */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} opacity="0.78">
          <line x1={p.hip[0]} y1={p.hip[1]} x2={p.backKnee[0]} y2={p.backKnee[1]} />
          <line x1={p.backKnee[0]} y1={p.backKnee[1]} x2={p.backAnkle[0]} y2={p.backAnkle[1]} />
        </g>

        {/* Feet */}
        <g stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.frontAnkle[0] - 12} y1="220" x2={p.frontAnkle[0] + 12} y2="220" />
          <line x1={p.backAnkle[0] - 10} y1="220" x2={p.backAnkle[0] + 10} y2="220" opacity="0.78" />
        </g>

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
          <circle cx={p.frontKnee[0]} cy={p.frontKnee[1]} r="3" />
          <circle cx={p.backKnee[0]} cy={p.backKnee[1]} r="3" opacity="0.78" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
