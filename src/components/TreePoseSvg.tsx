'use client';
import { useId } from 'react';

/**
 * Tree Pose stickman — front view, two variants:
 *   hero      — correct: standing on one leg, lifted foot pressed onto inner
 *               thigh of standing leg, hands at chest in prayer position
 *   foot-off  — wrong: lifted foot has drifted away from the standing leg
 *
 * Individual <line> elements (no polyline — see PlankSvg.tsx). Glow filter
 * uses filterUnits="userSpaceOnUse" with explicit region.
 */
type Variant = 'hero' | 'foot-off';

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

export function TreePoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `tp-glow-${uid}`;
  const floorId = `tp-floor-${uid}`;
  const arrowId = `tp-arrow-${uid}`;

  // Geometry — standing leg on the right, lifted leg on the left (camera POV).
  const STANDING_ANKLE_X = 200;
  const STANDING_ANKLE_Y = 180;
  const STANDING_KNEE_X = 200;
  const STANDING_KNEE_Y = 132;
  const STANDING_HIP_X = 188;
  const STANDING_HIP_Y = 96;
  const LIFTED_HIP_X = 156;
  const LIFTED_HIP_Y = 96;
  // Lifted knee bent outward; ankle ON the standing thigh (hero) or off (variant)
  const LIFTED_KNEE_X = 120;
  const LIFTED_KNEE_Y = 130;
  const LIFTED_ANKLE_X = variant === 'hero' ? STANDING_KNEE_X - 8 : 152;
  const LIFTED_ANKLE_Y = 125;

  const SHOULDER_MID_X = (STANDING_HIP_X + LIFTED_HIP_X) / 2;
  const SHOULDER_MID_Y = 56;
  const LEFT_SHOULDER_X = SHOULDER_MID_X - 22;
  const RIGHT_SHOULDER_X = SHOULDER_MID_X + 22;

  // Hands at chest (prayer position) — both wrists at sternum level
  const WRIST_X = SHOULDER_MID_X;
  const WRIST_Y = SHOULDER_MID_Y + 26;
  const LEFT_ELBOW_X = LEFT_SHOULDER_X + 8;
  const LEFT_ELBOW_Y = SHOULDER_MID_Y + 14;
  const RIGHT_ELBOW_X = RIGHT_SHOULDER_X - 8;
  const RIGHT_ELBOW_Y = SHOULDER_MID_Y + 14;

  const liftedColor = variant === 'foot-off' ? DANGER : TEAL;

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
        <ellipse cx={STANDING_ANKLE_X} cy={STANDING_ANKLE_Y + 8} rx="100" ry="5" fill={`url(#${floorId})`} />
        <line x1="80" y1={STANDING_ANKLE_Y + 8} x2="320" y2={STANDING_ANKLE_Y + 8} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Standing leg (teal) */}
        <line x1={STANDING_HIP_X} y1={STANDING_HIP_Y} x2={STANDING_KNEE_X} y2={STANDING_KNEE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={STANDING_KNEE_X} y1={STANDING_KNEE_Y} x2={STANDING_ANKLE_X} y2={STANDING_ANKLE_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Lifted leg */}
        <line x1={LIFTED_HIP_X} y1={LIFTED_HIP_Y} x2={LIFTED_KNEE_X} y2={LIFTED_KNEE_Y}
          stroke={liftedColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LIFTED_KNEE_X} y1={LIFTED_KNEE_Y} x2={LIFTED_ANKLE_X} y2={LIFTED_ANKLE_Y}
          stroke={liftedColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Hips + spine + shoulders */}
        <line x1={LIFTED_HIP_X} y1={LIFTED_HIP_Y} x2={STANDING_HIP_X} y2={STANDING_HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={SHOULDER_MID_X} y1={SHOULDER_MID_Y} x2={(LIFTED_HIP_X + STANDING_HIP_X) / 2} y2={(LIFTED_HIP_Y + STANDING_HIP_Y) / 2}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_MID_Y} x2={RIGHT_SHOULDER_X} y2={SHOULDER_MID_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms (prayer position) */}
        <line x1={LEFT_SHOULDER_X} y1={SHOULDER_MID_Y} x2={LEFT_ELBOW_X} y2={LEFT_ELBOW_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_ELBOW_X} y1={LEFT_ELBOW_Y} x2={WRIST_X} y2={WRIST_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_SHOULDER_X} y1={SHOULDER_MID_Y} x2={RIGHT_ELBOW_X} y2={RIGHT_ELBOW_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_ELBOW_X} y1={RIGHT_ELBOW_Y} x2={WRIST_X} y2={WRIST_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={SHOULDER_MID_X} cy={SHOULDER_MID_Y - 20} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_SHOULDER_X} cy={SHOULDER_MID_Y} r="3.5" />
          <circle cx={RIGHT_SHOULDER_X} cy={SHOULDER_MID_Y} r="3.5" />
          <circle cx={STANDING_HIP_X} cy={STANDING_HIP_Y} r="3.5" />
          <circle cx={LIFTED_HIP_X} cy={LIFTED_HIP_Y} r="3.5" />
          <circle cx={STANDING_KNEE_X} cy={STANDING_KNEE_Y} r="3.5" />
          <circle cx={LIFTED_KNEE_X} cy={LIFTED_KNEE_Y} r="3.5" />
          <circle cx={STANDING_ANKLE_X} cy={STANDING_ANKLE_Y} r="3.5" />
          <circle cx={LIFTED_ANKLE_X} cy={LIFTED_ANKLE_Y} r="3.5" />
        </g>

        {/* Wrong-form annotation */}
        {variant === 'foot-off' && (
          <g>
            <path d={`M ${STANDING_KNEE_X - 8} ${LIFTED_ANKLE_Y} L ${LIFTED_ANKLE_X + 6} ${LIFTED_ANKLE_Y}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="180" y="196" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Foot drifting off the leg
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
