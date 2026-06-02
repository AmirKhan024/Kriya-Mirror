'use client';
import { useId } from 'react';

/**
 * Tandem Stand stickman — front view, heel-to-toe stance, hands on hips.
 *   stand    : correct tandem position (calibration / hero)
 *   shifted  : mid-sway (slight off-center body) — instructional
 *   hero     : alias for stand
 *
 * Body drawn as individual <line> segments (NEVER polyline — B5).
 * Every <filter> uses filterUnits="userSpaceOnUse" + explicit region (B3) and
 * unique IDs derived from useId() (B4). Brand tokens only — no hex literals
 * in className (B6).
 *
 * Visual emphasis: one foot AHEAD of the other (heel-to-toe). In 2D front view
 * this looks like both feet stacked vertically along the same x-line. The
 * stickman shows ankles aligned in x with the front foot drawn slightly lower
 * in frame (foreshortening cue).
 */
type Variant = 'stand' | 'shifted' | 'hero';

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
  leftElbow: [number, number];
  rightElbow: [number, number];
  leftHand: [number, number];      // on hip
  rightHand: [number, number];
  /** Knees + ankles ordered front-then-back. */
  frontKnee: [number, number];
  frontAnkle: [number, number];
  backKnee: [number, number];
  backAnkle: [number, number];
}

// viewBox 220 × 240. Body centred at x=110. Tandem feet stacked at x ≈ 110.
const POSES: Record<Variant, Pose> = {
  stand: {
    head:       [110, 30],
    shoulder:   [110, 60],
    hip:        [110, 118],
    leftElbow:  [88, 90],
    rightElbow: [132, 90],
    leftHand:   [102, 118],
    rightHand:  [118, 118],
    frontKnee:  [108, 165],
    frontAnkle: [108, 215],
    backKnee:   [112, 165],
    backAnkle:  [112, 213],
  },
  shifted: {
    head:       [114, 32],
    shoulder:   [114, 62],
    hip:        [114, 120],
    leftElbow:  [92, 92],
    rightElbow: [136, 92],
    leftHand:   [106, 120],
    rightHand:  [122, 120],
    frontKnee:  [110, 165],
    frontAnkle: [108, 215],
    backKnee:   [114, 165],
    backAnkle:  [112, 213],
  },
  hero: {
    head:       [110, 30],
    shoulder:   [110, 60],
    hip:        [110, 118],
    leftElbow:  [88, 90],
    rightElbow: [132, 90],
    leftHand:   [102, 118],
    rightHand:  [118, 118],
    frontKnee:  [108, 165],
    frontAnkle: [108, 215],
    backKnee:   [112, 165],
    backAnkle:  [112, 213],
  },
};

export function TandemStandSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `ts-glow-${uid}`;
  const floorId = `ts-floor-${uid}`;
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

        {/* Tandem-line guide (subtle vertical dashed line through feet) */}
        <line
          x1={p.frontAnkle[0]} y1="200" x2={p.frontAnkle[0]} y2="225"
          stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" opacity="0.6"
        />

        {/* Torso */}
        <line
          x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.hip[0]} y2={p.hip[1]}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Arms — hands on hips. Drawn as 4 individual lines (shoulder→elbow→hand each side). */}
        <g stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`} opacity="0.9">
          <line x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.leftElbow[0]} y2={p.leftElbow[1]} />
          <line x1={p.leftElbow[0]} y1={p.leftElbow[1]} x2={p.leftHand[0]} y2={p.leftHand[1]} />
          <line x1={p.shoulder[0]} y1={p.shoulder[1]} x2={p.rightElbow[0]} y2={p.rightElbow[1]} />
          <line x1={p.rightElbow[0]} y1={p.rightElbow[1]} x2={p.rightHand[0]} y2={p.rightHand[1]} />
        </g>

        {/* Front leg */}
        <g stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.hip[0]} y1={p.hip[1]} x2={p.frontKnee[0]} y2={p.frontKnee[1]} />
          <line x1={p.frontKnee[0]} y1={p.frontKnee[1]} x2={p.frontAnkle[0]} y2={p.frontAnkle[1]} />
        </g>
        {/* Back leg (slightly less prominent so the tandem stacking reads) */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} opacity="0.7">
          <line x1={p.hip[0]} y1={p.hip[1]} x2={p.backKnee[0]} y2={p.backKnee[1]} />
          <line x1={p.backKnee[0]} y1={p.backKnee[1]} x2={p.backAnkle[0]} y2={p.backAnkle[1]} />
        </g>

        {/* Feet (heel-to-toe horizontal markers) */}
        <g stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.frontAnkle[0] - 11} y1="222" x2={p.frontAnkle[0] + 11} y2="222" />
          <line x1={p.backAnkle[0] - 9} y1="220" x2={p.backAnkle[0] + 9} y2="220" opacity="0.7" />
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
          <circle cx={p.backKnee[0]} cy={p.backKnee[1]} r="3" opacity="0.7" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
