'use client';
import { useId } from 'react';

/**
 * Push-Up stickman — side view, four variants.
 *   hero   — top of the push-up (arms straight, body horizontal)
 *   top    — same as hero (used by setup/instructions)
 *   mid    — mid-rep, elbows ~45° bent, body lowered a bit
 *   bottom — bottom of push-up (elbows ~90°, body close to floor)
 *
 * Body drawn as individual <line> segments (NEVER a polyline — see
 * .context/03_KNOWN_ISSUES_TO_PREVENT.md → B5). Every <filter> has
 * `filterUnits="userSpaceOnUse"` + explicit region (B3) and unique IDs
 * derived from useId() (B4). Brand tokens only — no hex literals in
 * className strings (B6).
 */
type Variant = 'hero' | 'top' | 'mid' | 'bottom';

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
  shoulderY: number;  // y of the horizontal body line
  elbowX: number;
  elbowY: number;
}

// viewBox 360 × 200. Body span shoulderX=80 → ankleX=300, hip at midpoint.
// At "top" the body is high (shoulderY≈100); at "bottom" the body is closer
// to floor (shoulderY≈140). Wrist is planted at (80, 175) always.
const POSES: Record<Variant, Pose> = {
  hero:   { shoulderY: 100, elbowX: 110, elbowY: 138 },
  top:    { shoulderY: 100, elbowX: 110, elbowY: 138 },
  mid:    { shoulderY: 120, elbowX: 100, elbowY: 148 },
  bottom: { shoulderY: 140, elbowX:  92, elbowY: 158 },
};

export function PushupSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `pu-glow-${uid}`;
  const floorId = `pu-floor-${uid}`;

  const SHOULDER_X = 80;
  const HIP_X = 190;
  const ANKLE_X = 300;
  const WRIST_X = 80;
  const WRIST_Y = 175;
  const TOE_Y = 175;

  const p = POSES[variant];
  const shoulderY = p.shoulderY;
  const hipY = shoulderY;     // body horizontal — hip lies on the shoulder-ankle line
  const ankleY = shoulderY;

  return (
    <div className={className}>
      <svg viewBox="0 0 360 200" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          {/* B3: explicit filter region so axis-aligned lines don't get clipped. */}
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="400" height="240">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Floor */}
        <ellipse cx="190" cy="183" rx="140" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="183" x2="340" y2="183" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Body — three individual lines (shoulder→hip, hip→ankle) — NEVER polyline (B5).
            Plus the head and toes for full silhouette. */}
        <g stroke={TEAL} strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={SHOULDER_X} y1={shoulderY} x2={HIP_X} y2={hipY} strokeWidth="8" />
          <line x1={HIP_X} y1={hipY} x2={ANKLE_X} y2={ankleY} strokeWidth="8" />
        </g>

        {/* Arm — shoulder→elbow→wrist (two individual lines) */}
        <g stroke={TEAL} strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={SHOULDER_X} y1={shoulderY} x2={p.elbowX} y2={p.elbowY} strokeWidth="6" />
          <line x1={p.elbowX} y1={p.elbowY} x2={WRIST_X} y2={WRIST_Y} strokeWidth="6" />
        </g>

        {/* Toes / foot contact */}
        <g stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`}>
          <line x1={ANKLE_X} y1={ankleY} x2={ANKLE_X + 8} y2={TOE_Y} />
          <line x1={ANKLE_X + 4} y1={TOE_Y - 2} x2={ANKLE_X + 22} y2={TOE_Y - 2} />
        </g>

        {/* Head — slightly past the shoulder toward the head direction */}
        <circle
          cx={SHOULDER_X - 22} cy={shoulderY - 10} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5"
          filter={`url(#${glowId})`}
        />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_X} cy={shoulderY} r="3.5" />
          <circle cx={p.elbowX} cy={p.elbowY} r="3.5" />
          <circle cx={HIP_X} cy={hipY} r="3.5" />
          <circle cx={ANKLE_X} cy={ankleY} r="3.5" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
