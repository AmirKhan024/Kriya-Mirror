'use client';
import { useId } from 'react';

/**
 * Cat-Cow (Marjaryasana–Bitilasana) stickman — SIDE view, on hands and knees.
 *   hero — the cow phase: knees + hands planted, hips and shoulders raised,
 *          the spine arched into a gentle belly-down dip with the head LIFTED.
 *
 * The exercise alternates this arch (cow, head up) with a rounded back (cat,
 * head tucked); the hero illustration shows the cow arch so the camera-facing
 * quadruple stance and head lift read clearly. Spine drawn as a single curved
 * <path>; limbs as individual <line>s (the polyline bug — see PlankSvg.tsx).
 */
type Variant = 'hero' | 'round';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function CatCowSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `cc-glow-${uid}`;
  const floorId = `cc-floor-${uid}`;

  const FLOOR_Y = 162;

  // Quadruped base: knee (back support) and wrist (front support) planted on the
  // floor; head to the right. Hip and shoulder are raised off the floor.
  const KNEE_X = 122, KNEE_Y = FLOOR_Y - 2;
  const WRIST_X = 244, WRIST_Y = FLOOR_Y - 2;

  const HIP_X = 150, HIP_Y = 104;
  const SHOULDER_X = 232, SHOULDER_Y = 108;

  // Cow: spine dips (belly down) and the head lifts. Round: spine humps up and
  // the head tucks. Control point + head position switch on the variant.
  const isCow = variant === 'hero';
  const SPINE_CTRL_X = (HIP_X + SHOULDER_X) / 2;
  const SPINE_CTRL_Y = isCow ? 140 : 78;     // below midline = cow dip; above = cat hump

  // Head just forward of the shoulder; lifted (cow) or tucked down (cat).
  const NECK_X = SHOULDER_X + 26;
  const NECK_Y = isCow ? SHOULDER_Y - 18 : SHOULDER_Y + 16;
  const HEAD_X = NECK_X + 14;
  const HEAD_Y = isCow ? NECK_Y - 8 : NECK_Y + 8;

  // Back foot/shin trailing along the floor behind the knee.
  const FOOT_X = KNEE_X - 30;

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
        <ellipse cx="185" cy={FLOOR_Y + 6} rx="160" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1={FLOOR_Y + 4} x2="345" y2={FLOOR_Y + 4} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Spine — hip → shoulder, arched (cow) or humped (cat) */}
        <path
          d={`M ${HIP_X} ${HIP_Y} Q ${SPINE_CTRL_X} ${SPINE_CTRL_Y} ${SHOULDER_X} ${SHOULDER_Y}`}
          fill="none"
          stroke={TEAL}
          strokeWidth="8"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Back leg — hip → knee (thigh) → trailing foot */}
        <line x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={FOOT_X} y2={FLOOR_Y - 2} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Front arm — shoulder → wrist (hand planted) */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={WRIST_X} y2={WRIST_Y} stroke={TEAL} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Neck → head */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={NECK_X} y2={NECK_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <circle cx={HEAD_X} cy={HEAD_Y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={WRIST_X} cy={WRIST_Y} r="3.5" />
        </g>

        {/* Arch direction hint */}
        <text x="185" y="192" fontSize="11" fill={MUTED} textAnchor="middle">
          {isCow ? 'Cow — arch, head up' : 'Cat — round, head down'}
        </text>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
