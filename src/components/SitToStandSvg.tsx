'use client';
import { useId } from 'react';

/**
 * Sit-to-Stand stickman — SIDE view, three variants:
 *   hero     — correct: standing tall at the top of the rep, chair behind
 *   seated   — seated on the chair (knees ~90°)
 *   shallow  — wrong: half-risen, hips still low
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx).
 * Glow filter uses filterUnits="userSpaceOnUse" with an explicit region.
 */
type Variant = 'hero' | 'seated' | 'shallow';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function SitToStandSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `sts-glow-${uid}`;
  const floorId = `sts-floor-${uid}`;

  const ANKLE_X = 205, ANKLE_Y = 168;
  const KNEE_X = ANKLE_X; // shin roughly vertical
  const KNEE_Y = 132;

  // hero = standing (hip high, above the knee); seated/shallow = hip back & low.
  const standing = variant === 'hero';
  const half = variant === 'shallow';
  const HIP_X = standing ? KNEE_X - 4 : half ? 168 : 150;
  const HIP_Y = standing ? 96 : half ? 120 : 130;
  const SHOULDER_X = standing ? HIP_X : HIP_X + 14; // lean forward when not yet up
  const SHOULDER_Y = HIP_Y - 48;

  const bodyColor = half ? AMBER : TEAL;

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
        <ellipse cx="190" cy="178" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="178" x2="345" y2="178" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Chair behind (seat + back) */}
        <line x1="120" y1="138" x2="160" y2="138" stroke={MUTED} strokeWidth="3" opacity="0.7" />
        <line x1="120" y1="138" x2="120" y2="178" stroke={MUTED} strokeWidth="3" opacity="0.7" />
        <line x1="160" y1="138" x2="160" y2="178" stroke={MUTED} strokeWidth="3" opacity="0.7" />
        <line x1="120" y1="138" x2="120" y2="96" stroke={MUTED} strokeWidth="3" opacity="0.7" />

        {/* Body segments — torso, thigh, shin */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={HIP_X} y2={HIP_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={ANKLE_X} y2={ANKLE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arm */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={SHOULDER_X + (standing ? 4 : 18)} y2={SHOULDER_Y + 34} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Foot */}
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X + 18} y2={ANKLE_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={SHOULDER_X} cy={SHOULDER_Y - 22} r="13" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
        </g>

        {variant === 'shallow' && (
          <text x="190" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Stand all the way up
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
