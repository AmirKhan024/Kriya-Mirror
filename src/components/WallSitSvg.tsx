'use client';
import { useId } from 'react';

/**
 * Wall Sit stickman — side view with the wall drawn behind the back.
 *   hero            — correct: back flat on wall, thighs parallel, shins vertical
 *   knees-straight  — wrong: hips have slid up the wall (knees straightening)
 *   forward-lean    — wrong: torso has peeled off the wall, leaning forward
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx for
 * the bug that motivated this). Glow filter uses filterUnits="userSpaceOnUse"
 * with an explicit region so lines don't get clipped.
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

export function WallSitSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `ws-glow-${uid}`;
  const floorId = `ws-floor-${uid}`;
  const arrowId = `ws-arrow-${uid}`;

  // Wall is a vertical line just behind the back.
  const WALL_X = 145;

  const ANKLE_X = 215, ANKLE_Y = 168;
  // Shins vertical → knee directly above ankle.
  const KNEE_X = ANKLE_X;
  const KNEE_Y = variant === 'knees-straight' ? 132 : 120;
  // Thigh runs back toward the wall (≈ horizontal in the hero). Hips ride up
  // the wall in the knees-straight variant (losing depth).
  const HIP_X = WALL_X + 8;
  const HIP_Y = variant === 'knees-straight' ? 92 : 120;
  // Back vertical against the wall for hero; forward-lean peels the shoulder off.
  const SHOULDER_X = variant === 'forward-lean' ? HIP_X + 36 : HIP_X;
  const SHOULDER_Y = HIP_Y - 52;

  const bodyColor = variant === 'forward-lean' ? DANGER
    : variant === 'knees-straight' ? AMBER
      : TEAL;

  // Arms hang relaxed down from the shoulder.
  const WRIST_X = SHOULDER_X + 4;
  const WRIST_Y = SHOULDER_Y + 44;

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
        <ellipse cx="200" cy="178" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="30" y1="178" x2="345" y2="178" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Wall behind the back */}
        <line x1={WALL_X} y1="38" x2={WALL_X} y2="178" stroke={MUTED} strokeWidth="3" opacity="0.7" />

        {/* Reference: ideal upright back for the forward-lean variant */}
        {variant === 'forward-lean' && (
          <g opacity="0.55">
            <line x1={HIP_X} y1={HIP_Y} x2={HIP_X} y2={SHOULDER_Y} stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={HIP_X - 6} y={SHOULDER_Y - 4} fontSize="9" fill={TEAL} textAnchor="end">
              ideal back
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

        {/* Arm — shoulder to wrist (relaxed down) */}
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
            <path d={`M ${HIP_X} ${120} L ${HIP_X} ${HIP_Y + 6}`} stroke={AMBER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="200" y="196" fontSize="12" fill={AMBER} textAnchor="middle" fontWeight="700">
              Hips sliding up
            </text>
          </g>
        )}
        {variant === 'forward-lean' && (
          <g>
            <path d={`M ${HIP_X + 4} ${SHOULDER_Y} L ${SHOULDER_X - 6} ${SHOULDER_Y}`} stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="210" y="196" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Leaning off the wall
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
