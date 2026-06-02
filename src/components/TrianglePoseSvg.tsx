'use client';
import { useId } from 'react';

/**
 * Triangle Pose stickman — FRONT view, three variants:
 *   hero          — correct: wide stance, BOTH legs straight, trunk hinged
 *                   laterally toward the front foot, top arm reaching up
 *                   vertically, bottom hand at the front-foot toe
 *   knee-bent     — wrong: front knee bending (a leg is no longer straight)
 *   arm-not-down  — wrong: bottom hand lifted away from the front foot
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx).
 */
type Variant = 'hero' | 'knee-bent' | 'arm-not-down';

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

export function TrianglePoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `tp-glow-${uid}`;
  const floorId = `tp-floor-${uid}`;
  const arrowId = `tp-arrow-${uid}`;

  // FRONT view, viewBox 360×200. User facing camera. Wide stance.
  // Convention: front foot at the RIGHT side of the frame (frontLeg = right).
  const LEFT_ANKLE = { x: 280, y: 175 };  // user's left foot — back leg
  const RIGHT_ANKLE = { x: 80, y: 175 };  // user's right foot — front leg

  // Hips stacked near center.
  const HIP_MID = { x: 180, y: 110 };
  const LEFT_HIP = { x: HIP_MID.x + 8, y: HIP_MID.y };
  const RIGHT_HIP = { x: HIP_MID.x - 8, y: HIP_MID.y };

  // Per-leg knee: midpoint of (hip, ankle); offset for knee-bent variant.
  const FRONT_KNEE_BEND = variant === 'knee-bent' ? 20 : 0;
  const LEFT_KNEE = {
    x: (LEFT_HIP.x + LEFT_ANKLE.x) / 2,
    y: (LEFT_HIP.y + LEFT_ANKLE.y) / 2,
  };
  const RIGHT_KNEE = {
    x: (RIGHT_HIP.x + RIGHT_ANKLE.x) / 2 + FRONT_KNEE_BEND,
    y: (RIGHT_HIP.y + RIGHT_ANKLE.y) / 2,
  };

  // Spine hinges 50° toward the front foot (toward -X since front foot is
  // on the left side of the frame).
  // shoulderMid = hipMid + (-sin(50°) × 60, -cos(50°) × 60)
  const SHOULDER_MID = { x: HIP_MID.x - 46, y: HIP_MID.y - 38 };

  // Shoulder line perpendicular to spine. Top shoulder up-and-toward back,
  // bottom shoulder down-and-toward front.
  const TOP_SHOULDER = { x: SHOULDER_MID.x + 13, y: SHOULDER_MID.y - 15 };
  const BOTTOM_SHOULDER = { x: SHOULDER_MID.x - 13, y: SHOULDER_MID.y + 15 };

  // Top arm — straight UP from top shoulder (with tilt for arm-not-down
  // variant being arm-tilted… reused here as a "bottom arm lifted" variant,
  // so the top arm stays vertical).
  const TOP_WRIST = { x: TOP_SHOULDER.x, y: TOP_SHOULDER.y - 56 };

  // Bottom hand: ideal = at the front-ankle X+Y; arm-not-down variant lifts
  // it upward.
  const BOTTOM_LIFT = variant === 'arm-not-down' ? 40 : 0;
  const BOTTOM_HAND = { x: RIGHT_ANKLE.x, y: RIGHT_ANKLE.y - BOTTOM_LIFT };

  // Head — at the top shoulder (gaze up toward the top hand).
  const HEAD = { x: TOP_SHOULDER.x, y: TOP_SHOULDER.y - 22 };

  const frontLegColor = variant === 'knee-bent' ? DANGER : TEAL;
  const bottomArmColor = variant === 'arm-not-down' ? DANGER : TEAL;

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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={variant === 'knee-bent' || variant === 'arm-not-down' ? DANGER : AMBER} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="180" cy="183" rx="160" ry="5" fill={`url(#${floorId})`} />
        <line x1="20" y1="183" x2="340" y2="183" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Back leg (user's left foot on the right side of frame) — always teal */}
        <line x1={LEFT_HIP.x} y1={LEFT_HIP.y} x2={LEFT_KNEE.x} y2={LEFT_KNEE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={LEFT_KNEE.x} y1={LEFT_KNEE.y} x2={LEFT_ANKLE.x} y2={LEFT_ANKLE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Front leg (user's right foot on the left side of frame) */}
        <line x1={RIGHT_HIP.x} y1={RIGHT_HIP.y} x2={RIGHT_KNEE.x} y2={RIGHT_KNEE.y}
          stroke={frontLegColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_KNEE.x} y1={RIGHT_KNEE.y} x2={RIGHT_ANKLE.x} y2={RIGHT_ANKLE.y}
          stroke={frontLegColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Hip line */}
        <line x1={LEFT_HIP.x} y1={LEFT_HIP.y} x2={RIGHT_HIP.x} y2={RIGHT_HIP.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Spine — hip mid to shoulder mid (hinged toward front foot) */}
        <line x1={HIP_MID.x} y1={HIP_MID.y} x2={SHOULDER_MID.x} y2={SHOULDER_MID.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Shoulder line */}
        <line x1={TOP_SHOULDER.x} y1={TOP_SHOULDER.y} x2={BOTTOM_SHOULDER.x} y2={BOTTOM_SHOULDER.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Top arm — to the sky */}
        <line x1={TOP_SHOULDER.x} y1={TOP_SHOULDER.y} x2={TOP_WRIST.x} y2={TOP_WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Bottom arm — to the front foot */}
        <line x1={BOTTOM_SHOULDER.x} y1={BOTTOM_SHOULDER.y} x2={BOTTOM_HAND.x} y2={BOTTOM_HAND.y}
          stroke={bottomArmColor} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={HEAD.x} cy={HEAD.y} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5"
          filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={TOP_SHOULDER.x} cy={TOP_SHOULDER.y} r="3.5" />
          <circle cx={BOTTOM_SHOULDER.x} cy={BOTTOM_SHOULDER.y} r="3.5" />
          <circle cx={TOP_WRIST.x} cy={TOP_WRIST.y} r="3.5" />
          <circle cx={BOTTOM_HAND.x} cy={BOTTOM_HAND.y} r="3.5" />
          <circle cx={LEFT_HIP.x} cy={LEFT_HIP.y} r="3.5" />
          <circle cx={RIGHT_HIP.x} cy={RIGHT_HIP.y} r="3.5" />
          <circle cx={LEFT_KNEE.x} cy={LEFT_KNEE.y} r="3.5" />
          <circle cx={RIGHT_KNEE.x} cy={RIGHT_KNEE.y} r="3.5" />
          <circle cx={LEFT_ANKLE.x} cy={LEFT_ANKLE.y} r="3.5" />
          <circle cx={RIGHT_ANKLE.x} cy={RIGHT_ANKLE.y} r="3.5" />
        </g>

        {/* Wrong-form annotations */}
        {variant === 'knee-bent' && (
          <g>
            <path d={`M ${RIGHT_KNEE.x - FRONT_KNEE_BEND} ${RIGHT_KNEE.y + 4} L ${RIGHT_KNEE.x - 4} ${RIGHT_KNEE.y + 4}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Front knee bending
            </text>
          </g>
        )}
        {variant === 'arm-not-down' && (
          <g>
            <path d={`M ${RIGHT_ANKLE.x + 14} ${RIGHT_ANKLE.y} L ${BOTTOM_HAND.x + 14} ${BOTTOM_HAND.y + 4}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Bottom hand not at front foot
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
