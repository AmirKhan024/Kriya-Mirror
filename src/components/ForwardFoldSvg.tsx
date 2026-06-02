'use client';
import { useId } from 'react';

/**
 * Standing Forward Fold (Uttanasana) stickman — side view, three variants:
 *   hero        — correct: deep hinge at the hips, legs straight, head hanging down
 *   shallow     — wrong: torso only half folded (not folded enough)
 *   knees-bent  — wrong: knees bent (the fold should be a hip hinge)
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx for
 * the bug that motivated this). Glow filter uses filterUnits="userSpaceOnUse"
 * with an explicit region so near-horizontal lines don't get clipped.
 */
type Variant = 'hero' | 'shallow' | 'knees-bent';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function ForwardFoldSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `ff-glow-${uid}`;
  const floorId = `ff-floor-${uid}`;

  // Legs are straight and roughly vertical for hero/shallow; bent for knees-bent.
  const ANKLE_X = 200, ANKLE_Y = 168;
  const KNEE_X = variant === 'knees-bent' ? 224 : 199;
  const KNEE_Y = variant === 'knees-bent' ? 128 : 124;
  const HIP_X = 196;
  const HIP_Y = variant === 'knees-bent' ? 96 : 80;

  // Torso hinges forward + down from the hip. Hero folds deep (shoulder well
  // below hip, head toward the floor); shallow only tips halfway.
  const SHOULDER_X = variant === 'shallow' ? 226 : 250;
  const SHOULDER_Y = variant === 'shallow' ? 96 : HIP_Y + 46;

  const bodyColor = variant === 'hero' ? TEAL : AMBER;

  // Head hangs just beyond the shoulder along the fold direction.
  const HEAD_X = SHOULDER_X + 12;
  const HEAD_Y = SHOULDER_Y + 14;

  // Arms hang down from the shoulder toward the floor.
  const WRIST_X = SHOULDER_X + 4;
  const WRIST_Y = SHOULDER_Y + 38;

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
        <ellipse cx="200" cy="178" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="178" x2="340" y2="178" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Legs — hip → knee → ankle */}
        <line x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={KNEE_X} y1={KNEE_Y} x2={ANKLE_X} y2={ANKLE_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Torso — hip → shoulder (the fold) */}
        <line x1={HIP_X} y1={HIP_Y} x2={SHOULDER_X} y2={SHOULDER_Y} stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arm — shoulder → wrist (hanging toward floor) */}
        <line x1={SHOULDER_X} y1={SHOULDER_Y} x2={WRIST_X} y2={WRIST_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Foot */}
        <line x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X + 18} y2={ANKLE_Y} stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head — hanging below the shoulder */}
        <circle cx={HEAD_X} cy={HEAD_Y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {variant === 'shallow' && (
          <text x="200" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Fold deeper — hinge at the hips
          </text>
        )}
        {variant === 'knees-bent' && (
          <text x="200" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
            Keep your legs straight
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
