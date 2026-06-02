'use client';
import { useId } from 'react';

/**
 * Bicep Curl stickman — front view, four variants.
 *   extended : arms hanging at sides, elbow flex ~0° (calibration / bottom of rep)
 *   mid      : elbow flex ~90°, forearms horizontal
 *   top      : full curl, elbow flex ~140°, wrists near shoulders (peak)
 *   hero     : top of rep (same as 'top')
 *
 * Body drawn as individual <line> segments (NEVER polyline — B5).
 * Every <filter> uses filterUnits="userSpaceOnUse" + explicit region (B3) and
 * unique IDs derived from useId() (B4). Brand tokens only — no hex literals
 * in className (B6).
 */
type Variant = 'extended' | 'mid' | 'top' | 'hero';

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
  leftElbow: [number, number];
  leftWrist: [number, number];
  rightElbow: [number, number];
  rightWrist: [number, number];
}

// viewBox 220 × 240. Body centered at x=110.
// Shoulders at (95, 65) and (125, 65). Elbows just below shoulders.
// Wrist position varies by variant.
const POSES: Record<Variant, Pose> = {
  extended: {
    head:       [110, 35],
    shoulder:   [110, 65],
    hip:        [110, 118],
    knee:       [110, 168],
    ankle:      [110, 213],
    leftElbow:  [92, 100],
    leftWrist:  [92, 138],
    rightElbow: [128, 100],
    rightWrist: [128, 138],
  },
  mid: {
    head:       [110, 35],
    shoulder:   [110, 65],
    hip:        [110, 118],
    knee:       [110, 168],
    ankle:      [110, 213],
    leftElbow:  [92, 100],
    leftWrist:  [125, 100],     // forearm horizontal toward midline
    rightElbow: [128, 100],
    rightWrist: [95, 100],
  },
  top: {
    head:       [110, 35],
    shoulder:   [110, 65],
    hip:        [110, 118],
    knee:       [110, 168],
    ankle:      [110, 213],
    leftElbow:  [92, 100],
    leftWrist:  [102, 68],      // wrist up near shoulder
    rightElbow: [128, 100],
    rightWrist: [118, 68],
  },
  hero: {
    head:       [110, 35],
    shoulder:   [110, 65],
    hip:        [110, 118],
    knee:       [110, 168],
    ankle:      [110, 213],
    leftElbow:  [92, 100],
    leftWrist:  [102, 68],
    rightElbow: [128, 100],
    rightWrist: [118, 68],
  },
};

export function BicepCurlSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `bc-glow-${uid}`;
  const floorId = `bc-floor-${uid}`;
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
        <ellipse cx="110" cy="221" rx="55" ry="5" fill={`url(#${floorId})`} />
        <line x1="20" y1="221" x2="200" y2="221" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Torso + legs (individual lines) */}
        <g stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.hip[0]} y2={p.hip[1]} />
          <line x1={p.hip[0]} y1={p.hip[1]} x2={p.knee[0]} y2={p.knee[1]} />
          <line x1={p.knee[0]} y1={p.knee[1]} x2={p.ankle[0]} y2={p.ankle[1]} />
        </g>

        {/* Left arm — shoulder to elbow to wrist (two individual lines) */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.shoulder[0] - 15} y1={p.shoulder[1]} x2={p.leftElbow[0]} y2={p.leftElbow[1]} />
          <line x1={p.leftElbow[0]} y1={p.leftElbow[1]} x2={p.leftWrist[0]} y2={p.leftWrist[1]} />
        </g>

        {/* Right arm — shoulder to elbow to wrist */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.shoulder[0] + 15} y1={p.shoulder[1]} x2={p.rightElbow[0]} y2={p.rightElbow[1]} />
          <line x1={p.rightElbow[0]} y1={p.rightElbow[1]} x2={p.rightWrist[0]} y2={p.rightWrist[1]} />
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
          <circle cx={p.shoulder[0] - 15} cy={p.shoulder[1]} r="3" />
          <circle cx={p.shoulder[0] + 15} cy={p.shoulder[1]} r="3" />
          <circle cx={p.leftElbow[0]} cy={p.leftElbow[1]} r="3" />
          <circle cx={p.rightElbow[0]} cy={p.rightElbow[1]} r="3" />
          <circle cx={p.hip[0]} cy={p.hip[1]} r="3" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
