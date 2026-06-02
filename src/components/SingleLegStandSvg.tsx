'use client';
import { useId } from 'react';

/**
 * Single Leg Stand stickman — front view, three variants.
 *   standing : correct form — body upright, one foot lifted, hips level (calibration / hero)
 *   tilted   : wrong form — lifted-side hip drops (Trendelenburg sign)
 *   hero     : alias for standing
 *
 * Body drawn as individual <line> segments (NEVER polyline — B5).
 * Every <filter> uses filterUnits="userSpaceOnUse" + explicit region (B3) and
 * unique IDs derived from useId() (B4). Brand tokens only — no hex literals
 * in className (B6).
 */
type Variant = 'standing' | 'tilted' | 'hero';

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

interface Pose {
  head: [number, number];
  shoulder: [number, number];
  /** Hip center (between hips). Always at the body x midline. */
  leftHip: [number, number];
  rightHip: [number, number];
  /** Standing leg (right side of figure — viewer's right). */
  standingKnee: [number, number];
  standingAnkle: [number, number];
  /** Lifted leg (left side of figure — viewer's left). */
  liftedKnee: [number, number];
  liftedAnkle: [number, number];
  leftWrist: [number, number];
  rightWrist: [number, number];
}

// viewBox 220 × 240. Body centred at x=110. Standing leg = right side (figure's right = viewer's right).
const POSES: Record<Variant, Pose> = {
  standing: {
    head:           [110, 30],
    shoulder:       [110, 60],
    leftHip:        [100, 118],     // both hips at SAME y → level
    rightHip:       [120, 118],
    standingKnee:   [120, 165],
    standingAnkle:  [120, 213],
    liftedKnee:     [85, 155],      // lifted leg: bent at knee, ankle elevated
    liftedAnkle:    [70, 175],
    leftWrist:      [88, 130],      // arms relaxed at sides
    rightWrist:     [132, 130],
  },
  tilted: {
    head:           [110, 30],
    shoulder:       [110, 60],
    leftHip:        [100, 130],     // lifted-side hip DROPPED (12 lower)
    rightHip:       [120, 118],
    standingKnee:   [120, 165],
    standingAnkle:  [120, 213],
    liftedKnee:     [85, 165],
    liftedAnkle:    [70, 188],
    leftWrist:      [88, 135],
    rightWrist:     [132, 130],
  },
  hero: {
    head:           [110, 30],
    shoulder:       [110, 60],
    leftHip:        [100, 118],
    rightHip:       [120, 118],
    standingKnee:   [120, 165],
    standingAnkle:  [120, 213],
    liftedKnee:     [85, 155],
    liftedAnkle:    [70, 175],
    leftWrist:      [88, 130],
    rightWrist:     [132, 130],
  },
};

export function SingleLegStandSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sls-glow-${uid}`;
  const floorId = `sls-floor-${uid}`;
  const p = POSES[variant];
  const hipDanger = variant === 'tilted';

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

        {/* Reference horizontal line at standing-side hip (only on tilted to highlight the drop) */}
        {hipDanger && (
          <line
            x1="60" y1={p.rightHip[1]} x2="160" y2={p.rightHip[1]}
            stroke={TEAL} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55"
          />
        )}

        {/* Torso — shoulder to hip midpoint */}
        <line
          x1={p.shoulder[0]} y1={p.shoulder[1]}
          x2={(p.leftHip[0] + p.rightHip[0]) / 2} y2={(p.leftHip[1] + p.rightHip[1]) / 2}
          stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Pelvis (hip-to-hip line, colored red if tilted) */}
        <line
          x1={p.leftHip[0]} y1={p.leftHip[1]} x2={p.rightHip[0]} y2={p.rightHip[1]}
          stroke={hipDanger ? DANGER : TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}
        />

        {/* Standing leg (right side) */}
        <g stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.rightHip[0]} y1={p.rightHip[1]} x2={p.standingKnee[0]} y2={p.standingKnee[1]} />
          <line x1={p.standingKnee[0]} y1={p.standingKnee[1]} x2={p.standingAnkle[0]} y2={p.standingAnkle[1]} />
        </g>

        {/* Lifted leg (left side) — slightly thinner */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={p.leftHip[0]} y1={p.leftHip[1]} x2={p.liftedKnee[0]} y2={p.liftedKnee[1]} />
          <line x1={p.liftedKnee[0]} y1={p.liftedKnee[1]} x2={p.liftedAnkle[0]} y2={p.liftedAnkle[1]} />
        </g>

        {/* Arms relaxed at sides — shoulder→wrist single line on each side */}
        <g stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`} opacity="0.85">
          <line x1={p.shoulder[0] - 15} y1={p.shoulder[1]} x2={p.leftWrist[0]} y2={p.leftWrist[1]} />
          <line x1={p.shoulder[0] + 15} y1={p.shoulder[1]} x2={p.rightWrist[0]} y2={p.rightWrist[1]} />
        </g>

        {/* Standing foot */}
        <line
          x1={p.standingAnkle[0] - 12} y1="220" x2={p.standingAnkle[0] + 12} y2="220"
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
          <circle cx={p.leftHip[0]} cy={p.leftHip[1]} r="3" />
          <circle cx={p.rightHip[0]} cy={p.rightHip[1]} r="3" />
          <circle cx={p.standingKnee[0]} cy={p.standingKnee[1]} r="3" />
          <circle cx={p.liftedKnee[0]} cy={p.liftedKnee[1]} r="3" />
        </g>

        {hipDanger && (
          <text x="110" y="200" fontSize="11" fill={DANGER} textAnchor="middle" fontWeight="700">
            Hip dropped
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
