'use client';
import { useId } from 'react';

/**
 * Warrior II stickman — side view, three variants:
 *   hero       — correct: wide stance, front knee bent ~90°, back leg straight,
 *                trunk upright, arms extended laterally
 *   knee-up    — wrong: front knee too straight (standing too tall)
 *   lean       — wrong: torso leaning forward over front leg
 *
 * Each limb as individual <line> elements (no polyline — see PlankSvg).
 */
type Variant = 'hero' | 'knee-up' | 'lean';

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

export function WarriorTwoSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `w2-glow-${uid}`;
  const floorId = `w2-floor-${uid}`;
  const arrowId = `w2-arrow-${uid}`;

  // Side view: front leg on the right, back leg on the left.
  const BACK_ANKLE = { x: 90, y: 175 };
  const FRONT_ANKLE = { x: 270, y: 175 };
  // Front knee directly above front ankle, knee bent (depth controlled by variant)
  const FRONT_KNEE_Y_HERO = 130;
  const FRONT_KNEE_Y_UP = 100;          // standing taller for knee-up variant
  const FRONT_KNEE = {
    x: FRONT_ANKLE.x,
    y: variant === 'knee-up' ? FRONT_KNEE_Y_UP : FRONT_KNEE_Y_HERO,
  };
  // Front hip: at knee-Y for hero (thigh horizontal), higher for knee-up (less flex).
  const FRONT_HIP = {
    x: FRONT_KNEE.x - 60,
    y: variant === 'knee-up' ? FRONT_KNEE.y - 8 : FRONT_KNEE.y,
  };
  // Back leg straight from back-ankle up to back-hip. Back hip near pelvis level.
  // For the SVG approximate; pelvis "level" between hip-back and front-hip.
  const BACK_HIP = { x: FRONT_HIP.x - 40, y: FRONT_HIP.y - 12 };
  // Back knee on the back-ankle to back-hip line, slightly closer to ankle for visual.
  const BACK_KNEE = {
    x: (BACK_ANKLE.x + BACK_HIP.x) / 2,
    y: (BACK_ANKLE.y + BACK_HIP.y) / 2,
  };

  // Torso: shoulder mid above hip mid. Lean tilts forward (right) for `lean` variant.
  const hipMidX = (FRONT_HIP.x + BACK_HIP.x) / 2;
  const hipMidY = (FRONT_HIP.y + BACK_HIP.y) / 2;
  const SHOULDER_LEAN_X = variant === 'lean' ? 30 : 0;
  const SHOULDER_MID = { x: hipMidX + SHOULDER_LEAN_X, y: hipMidY - 55 };

  // Arms extended laterally — one forward (right), one back (left). At shoulder Y.
  const ARM_LEN = 50;
  const LEFT_WRIST = { x: SHOULDER_MID.x - ARM_LEN, y: SHOULDER_MID.y };
  const RIGHT_WRIST = { x: SHOULDER_MID.x + ARM_LEN, y: SHOULDER_MID.y };

  const torsoColor = variant === 'lean' ? DANGER : TEAL;
  const frontLegColor = variant === 'knee-up' ? AMBER : TEAL;

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
          <marker id={arrowId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DANGER} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="180" cy="183" rx="140" ry="5" fill={`url(#${floorId})`} />
        <line x1="20" y1="183" x2="340" y2="183" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Back leg (always teal) */}
        <line x1={BACK_HIP.x} y1={BACK_HIP.y} x2={BACK_KNEE.x} y2={BACK_KNEE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={BACK_KNEE.x} y1={BACK_KNEE.y} x2={BACK_ANKLE.x} y2={BACK_ANKLE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Front leg */}
        <line x1={FRONT_HIP.x} y1={FRONT_HIP.y} x2={FRONT_KNEE.x} y2={FRONT_KNEE.y}
          stroke={frontLegColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={FRONT_KNEE.x} y1={FRONT_KNEE.y} x2={FRONT_ANKLE.x} y2={FRONT_ANKLE.y}
          stroke={frontLegColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Hip line */}
        <line x1={BACK_HIP.x} y1={BACK_HIP.y} x2={FRONT_HIP.x} y2={FRONT_HIP.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Spine */}
        <line x1={hipMidX} y1={hipMidY} x2={SHOULDER_MID.x} y2={SHOULDER_MID.y}
          stroke={torsoColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms extended laterally */}
        <line x1={SHOULDER_MID.x} y1={SHOULDER_MID.y} x2={LEFT_WRIST.x} y2={LEFT_WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={SHOULDER_MID.x} y1={SHOULDER_MID.y} x2={RIGHT_WRIST.x} y2={RIGHT_WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={SHOULDER_MID.x + (variant === 'lean' ? 12 : 0)} cy={SHOULDER_MID.y - 22} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_MID.x} cy={SHOULDER_MID.y} r="3.5" />
          <circle cx={BACK_HIP.x} cy={BACK_HIP.y} r="3.5" />
          <circle cx={FRONT_HIP.x} cy={FRONT_HIP.y} r="3.5" />
          <circle cx={BACK_KNEE.x} cy={BACK_KNEE.y} r="3.5" />
          <circle cx={FRONT_KNEE.x} cy={FRONT_KNEE.y} r="3.5" />
          <circle cx={BACK_ANKLE.x} cy={BACK_ANKLE.y} r="3.5" />
          <circle cx={FRONT_ANKLE.x} cy={FRONT_ANKLE.y} r="3.5" />
          <circle cx={LEFT_WRIST.x} cy={LEFT_WRIST.y} r="3.5" />
          <circle cx={RIGHT_WRIST.x} cy={RIGHT_WRIST.y} r="3.5" />
        </g>

        {/* Wrong-form annotation */}
        {variant === 'knee-up' && (
          <g>
            <path d={`M ${FRONT_KNEE.x + 16} ${FRONT_KNEE_Y_HERO} L ${FRONT_KNEE.x + 16} ${FRONT_KNEE_Y_UP + 8}`}
              stroke={AMBER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="200" y="197" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
              Front knee too straight
            </text>
          </g>
        )}
        {variant === 'lean' && (
          <g>
            <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Leaning forward
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
