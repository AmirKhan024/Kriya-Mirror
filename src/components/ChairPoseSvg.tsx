'use client';
import { useId } from 'react';

/**
 * Chair Pose stickman — side view, three variants:
 *   hero            — correct: hips back, knees bent ~90°, torso upright, arms forward
 *   knees-straight  — wrong: knees nearly straight (user is half-standing)
 *   forward-lean    — wrong: torso has tipped forward instead of sitting back
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx for
 * the bug that motivated this). Glow filter uses filterUnits="userSpaceOnUse"
 * with explicit region so horizontal lines don't get clipped.
 */
type Variant = 'hero' | 'knees-straight' | 'forward-lean';

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

export function ChairPoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `cp-glow-${uid}`;
  const floorId = `cp-floor-${uid}`;
  const arrowId = `cp-arrow-${uid}`;

  // Anchors. Variants tweak hip / knee / shoulder position relative to the
  // correct chair pose silhouette.
  const ANKLE_X = 200, ANKLE_Y = 168;
  const HIP_X = variant === 'forward-lean' ? 180 : 170;
  const HIP_Y = variant === 'knees-straight' ? 80 : 105;
  const KNEE_X = 220;
  const KNEE_Y = variant === 'knees-straight' ? 130 : 138;
  // Shoulder sits above hip with a slight forward lean for hero (chair pose is
  // not fully vertical — the spine leans slightly forward to counterbalance the
  // hips going back). forward-lean variant exaggerates this significantly.
  const SHOULDER_X = variant === 'forward-lean' ? 220 : HIP_X + 8;
  const SHOULDER_Y = HIP_Y - 50;

  const bodyColor = variant === 'forward-lean' ? DANGER
    : variant === 'knees-straight' ? AMBER
      : TEAL;

  // Arms extended forward for hero. Wrong variants don't matter, draw arms in
  // a neutral forward position regardless.
  const WRIST_X = SHOULDER_X + 50;
  const WRIST_Y = SHOULDER_Y - 4;

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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={bodyColor} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="190" cy="178" rx="140" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="178" x2="340" y2="178" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference: ideal hip position for wrong-form variants */}
        {variant !== 'hero' && (
          <g opacity="0.55">
            <circle cx={170} cy={105} r="5" fill="none" stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={132} y={108} fontSize="9" fill={TEAL} textAnchor="end">
              ideal hip
            </text>
          </g>
        )}

        {/* Body segments — torso (shoulder → hip), thigh (hip → knee), shin (knee → ankle) */}
        <line
          x1={SHOULDER_X} y1={SHOULDER_Y} x2={HIP_X} y2={HIP_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={HIP_X} y1={HIP_Y} x2={KNEE_X} y2={KNEE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={KNEE_X} y1={KNEE_Y} x2={ANKLE_X} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Arms — shoulder to wrist (extended forward) */}
        <line
          x1={SHOULDER_X} y1={SHOULDER_Y} x2={WRIST_X} y2={WRIST_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Foot */}
        <line
          x1={ANKLE_X} y1={ANKLE_Y} x2={ANKLE_X + 18} y2={ANKLE_Y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Head */}
        <circle
          cx={SHOULDER_X} cy={SHOULDER_Y - 22} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5"
          filter={`url(#${glowId})`}
        />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {/* Wrong-form annotation */}
        {variant === 'knees-straight' && (
          <g>
            <path d={`M ${HIP_X} 105 L ${HIP_X} ${HIP_Y + 6}`} stroke={AMBER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x={HIP_X} y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
              Knees straightening
            </text>
          </g>
        )}
        {variant === 'forward-lean' && (
          <g>
            <path d={`M 178 ${SHOULDER_Y} L ${SHOULDER_X - 6} ${SHOULDER_Y}`} stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="200" y="196" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
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
