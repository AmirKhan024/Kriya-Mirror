'use client';
import { useId } from 'react';

/**
 * 2026-05-28 round 21: Arm Circles stickman — FRONT view (re-architected from
 * side view to match the front-camera engine).
 *
 * Variants:
 *   hero / forward — arms overhead (peak position) with curved arrows on
 *                    either side indicating the circular motion
 *   backward       — arms overhead with reversed arrow direction
 *
 * Front view mirrors LateralRaiseSvg structure but with arms pointing fully
 * overhead (180° abduction) instead of horizontal (90°), since arm circles
 * require overhead extension at the top of each rep.
 */
type Variant = 'hero' | 'forward' | 'backward';

interface Props {
  variant?: Variant;
  className?: string;
  label?: string;
}

const TEAL = '#00E5CC';
const TEAL_SOFT = 'rgba(0, 229, 204, 0.18)';
const AMBER = '#FFB547';
const MUTED = '#5a6b80';

export function ArmCirclesSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `ac-glow-${uid}`;
  const floorId = `ac-floor-${uid}`;
  const arrowFwdId = `ac-arrow-fwd-${uid}`;
  const arrowBwdId = `ac-arrow-bwd-${uid}`;

  const isBackward = variant === 'backward';

  // Body geometry — centered, front view (mirror LateralRaiseSvg)
  const SHOULDER_Y = 90;
  const HIP_Y = 145;
  const ANKLE_Y = 188;
  const LEFT_X = 145;
  const RIGHT_X = 215;
  const MID_X = (LEFT_X + RIGHT_X) / 2;

  // Arms overhead — 170° abduction (just past vertical, for visual clarity)
  const ARM_LEN = 62;
  const armDeg = 170;
  const a = (armDeg * Math.PI) / 180;
  const leftWristX = LEFT_X - Math.sin(a) * ARM_LEN;
  const leftWristY = SHOULDER_Y + Math.cos(a) * ARM_LEN;
  const rightWristX = RIGHT_X + Math.sin(a) * ARM_LEN;
  const rightWristY = SHOULDER_Y + Math.cos(a) * ARM_LEN;

  // Curved arrows showing the circular path each wrist follows.
  // Each arc starts at the wrist (overhead) and curves outward then down.
  const arcRadius = 38;
  const leftArcStartX = leftWristX;
  const leftArcStartY = leftWristY;
  const leftArcEndX = leftWristX - arcRadius;
  const leftArcEndY = leftWristY + arcRadius;
  const rightArcStartX = rightWristX;
  const rightArcStartY = rightWristY;
  const rightArcEndX = rightWristX + arcRadius;
  const rightArcEndY = rightWristY + arcRadius;
  // Forward = arms come up in front; arrows shown going OUT-and-DOWN (descent half of circle).
  // Backward swap the marker direction.
  const leftArcPath = `M ${leftArcStartX} ${leftArcStartY} A ${arcRadius} ${arcRadius} 0 0 ${isBackward ? 0 : 1} ${leftArcEndX} ${leftArcEndY}`;
  const rightArcPath = `M ${rightArcStartX} ${rightArcStartY} A ${arcRadius} ${arcRadius} 0 0 ${isBackward ? 1 : 0} ${rightArcEndX} ${rightArcEndY}`;

  const bodyColor = TEAL;

  return (
    <div className={className}>
      <svg viewBox="0 0 360 220" className="w-full h-auto">
        <defs>
          <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL_SOFT} stopOpacity="0.30" />
            <stop offset="100%" stopColor={TEAL_SOFT} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} filterUnits="userSpaceOnUse" x="-20" y="-20" width="400" height="260">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id={arrowFwdId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={AMBER} />
          </marker>
          <marker id={arrowBwdId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={AMBER} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx={MID_X} cy={ANKLE_Y + 6} rx="120" ry="5" fill={`url(#${floorId})`} />
        <line x1="50" y1={ANKLE_Y + 6} x2="310" y2={ANKLE_Y + 6} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Curved arrows showing circle motion (behind body) */}
        <path
          d={leftArcPath}
          fill="none"
          stroke={AMBER}
          strokeWidth="2.5"
          strokeDasharray="6 4"
          opacity="0.75"
          markerEnd={isBackward ? `url(#${arrowBwdId})` : `url(#${arrowFwdId})`}
        />
        <path
          d={rightArcPath}
          fill="none"
          stroke={AMBER}
          strokeWidth="2.5"
          strokeDasharray="6 4"
          opacity="0.75"
          markerEnd={isBackward ? `url(#${arrowBwdId})` : `url(#${arrowFwdId})`}
        />

        {/* Torso (shoulder line + spine) */}
        <line x1={LEFT_X} y1={SHOULDER_Y} x2={RIGHT_X} y2={SHOULDER_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={SHOULDER_Y} x2={MID_X} y2={HIP_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Legs */}
        <line x1={MID_X} y1={HIP_Y} x2={LEFT_X + 5} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={MID_X} y1={HIP_Y} x2={RIGHT_X - 5} y2={ANKLE_Y}
          stroke={bodyColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms — straight up (overhead) */}
        <line x1={LEFT_X} y1={SHOULDER_Y} x2={leftWristX} y2={leftWristY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_X} y1={SHOULDER_Y} x2={rightWristX} y2={rightWristY}
          stroke={bodyColor} strokeWidth="7" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={MID_X} cy={SHOULDER_Y - 22} r="14"
          fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={RIGHT_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={MID_X} cy={HIP_Y} r="3.5" />
          <circle cx={leftWristX} cy={leftWristY} r="3.5" />
          <circle cx={rightWristX} cy={rightWristY} r="3.5" />
        </g>
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
