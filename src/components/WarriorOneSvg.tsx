'use client';
import { useId } from 'react';

/**
 * Warrior I stickman — side-on view, three variants:
 *   hero       — correct: lunge stance, front knee bent ~90°, back leg straight,
 *                trunk upright, BOTH arms reaching straight overhead
 *   knee-up    — wrong: front knee too straight (standing too tall)
 *   arms-down  — wrong: arms dropped to the sides (not overhead)
 *
 * Differs from WarriorTwoSvg only in the arms: Warrior I reaches overhead
 * (vertical), Warrior II extends laterally (horizontal). Each limb is an
 * individual <line> (no polyline — see PlankSvg).
 */
type Variant = 'hero' | 'knee-up' | 'arms-down';

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

export function WarriorOneSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `w1-glow-${uid}`;
  const floorId = `w1-floor-${uid}`;
  const arrowId = `w1-arrow-${uid}`;

  // Side view: front leg on the right, back leg on the left.
  const BACK_ANKLE = { x: 90, y: 175 };
  const FRONT_ANKLE = { x: 270, y: 175 };
  const FRONT_KNEE_Y_HERO = 130;
  const FRONT_KNEE_Y_UP = 100;          // standing taller for knee-up variant
  const FRONT_KNEE = {
    x: FRONT_ANKLE.x,
    y: variant === 'knee-up' ? FRONT_KNEE_Y_UP : FRONT_KNEE_Y_HERO,
  };
  const FRONT_HIP = {
    x: FRONT_KNEE.x - 60,
    y: variant === 'knee-up' ? FRONT_KNEE.y - 8 : FRONT_KNEE.y,
  };
  const BACK_HIP = { x: FRONT_HIP.x - 40, y: FRONT_HIP.y - 12 };
  const BACK_KNEE = {
    x: (BACK_ANKLE.x + BACK_HIP.x) / 2,
    y: (BACK_ANKLE.y + BACK_HIP.y) / 2,
  };

  // Torso: shoulder mid above hip mid (upright — Warrior I stays tall).
  const hipMidX = (FRONT_HIP.x + BACK_HIP.x) / 2;
  const hipMidY = (FRONT_HIP.y + BACK_HIP.y) / 2;
  const SHOULDER_MID = { x: hipMidX, y: hipMidY - 55 };

  // Arms — overhead (hero/knee-up) or dropped to the sides (arms-down, wrong).
  const armsUp = variant !== 'arms-down';
  const LEFT_ELBOW = armsUp
    ? { x: SHOULDER_MID.x - 9, y: SHOULDER_MID.y - 30 }
    : { x: SHOULDER_MID.x - 22, y: SHOULDER_MID.y + 28 };
  const RIGHT_ELBOW = armsUp
    ? { x: SHOULDER_MID.x + 9, y: SHOULDER_MID.y - 30 }
    : { x: SHOULDER_MID.x + 22, y: SHOULDER_MID.y + 28 };
  const LEFT_WRIST = armsUp
    ? { x: SHOULDER_MID.x - 4, y: SHOULDER_MID.y - 62 }
    : { x: SHOULDER_MID.x - 26, y: SHOULDER_MID.y + 58 };
  const RIGHT_WRIST = armsUp
    ? { x: SHOULDER_MID.x + 4, y: SHOULDER_MID.y - 62 }
    : { x: SHOULDER_MID.x + 26, y: SHOULDER_MID.y + 58 };

  const frontLegColor = variant === 'knee-up' ? AMBER : TEAL;
  const armColor = variant === 'arms-down' ? DANGER : TEAL;

  return (
    <div className={className}>
      <svg viewBox="0 -40 360 240" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-60" width="400" height="300">
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
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms — overhead (hero) or dropped (arms-down) */}
        <line x1={SHOULDER_MID.x} y1={SHOULDER_MID.y} x2={LEFT_ELBOW.x} y2={LEFT_ELBOW.y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_ELBOW.x} y1={LEFT_ELBOW.y} x2={LEFT_WRIST.x} y2={LEFT_WRIST.y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={SHOULDER_MID.x} y1={SHOULDER_MID.y} x2={RIGHT_ELBOW.x} y2={RIGHT_ELBOW.y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_ELBOW.x} y1={RIGHT_ELBOW.y} x2={RIGHT_WRIST.x} y2={RIGHT_WRIST.y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={SHOULDER_MID.x} cy={SHOULDER_MID.y - 22} r="13"
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

        {/* Wrong-form annotations */}
        {variant === 'knee-up' && (
          <g>
            <path d={`M ${FRONT_KNEE.x + 16} ${FRONT_KNEE_Y_HERO} L ${FRONT_KNEE.x + 16} ${FRONT_KNEE_Y_UP + 8}`}
              stroke={AMBER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="200" y="197" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
              Front knee too straight
            </text>
          </g>
        )}
        {variant === 'arms-down' && (
          <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
            Reach both arms overhead
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
