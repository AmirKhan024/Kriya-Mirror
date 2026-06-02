'use client';
import { useId } from 'react';

/**
 * Goddess Pose stickman — FRONT view, three variants:
 *   hero          — correct: wide stance ~2× shoulder-width, both knees bent
 *                   ~90 °, both arms in cactus (elbows at shoulder height,
 *                   forearms vertical, palms forward)
 *   knees-caving  — wrong: knee X positions collapse inward of the ankle line
 *                   (bilateral valgus)
 *   arms-dropped  — wrong: elbows fall below the shoulder line; cactus broken
 *
 * Body drawn as individual <line> elements (no polyline — see PlankSvg.tsx
 * for the bug that motivated this).
 */
type Variant = 'hero' | 'knees-caving' | 'arms-dropped';

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

export function GoddessPoseSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `gp-glow-${uid}`;
  const floorId = `gp-floor-${uid}`;
  const arrowId = `gp-arrow-${uid}`;

  // Front view, centered horizontally. Wide stance ~2× shoulder-width.
  const CX = 180;
  const ANKLE_Y = 168;
  const KNEE_Y = 138;
  const HIP_Y = 100;
  const SHOULDER_Y = 70;
  const HEAD_Y = SHOULDER_Y - 22;

  // Stance — feet wide, knees track over ankles (or cave for valgus variant).
  const LEFT_ANKLE_X = CX + 90;
  const RIGHT_ANKLE_X = CX - 90;
  const KNEE_OUTWARD = variant === 'knees-caving' ? 28 : 90;
  const LEFT_KNEE_X = CX + KNEE_OUTWARD;
  const RIGHT_KNEE_X = CX - KNEE_OUTWARD;
  const LEFT_HIP_X = CX + 32;
  const RIGHT_HIP_X = CX - 32;

  // Shoulders — narrower than hips. Cactus arms abducted ~90°: elbows further
  // out, wrists straight up (palms forward, forearm vertical).
  const SHOULDER_HALF = 30;
  const LEFT_SHOULDER_X = CX + SHOULDER_HALF;
  const RIGHT_SHOULDER_X = CX - SHOULDER_HALF;
  const ELBOW_OUT = 38;
  const ELBOW_Y_DROP = variant === 'arms-dropped' ? 28 : 0;
  const ELBOW_Y = SHOULDER_Y + ELBOW_Y_DROP;
  const LEFT_ELBOW_X = LEFT_SHOULDER_X + ELBOW_OUT;
  const RIGHT_ELBOW_X = RIGHT_SHOULDER_X - ELBOW_OUT;
  const WRIST_Y = ELBOW_Y - 32;   // forearm vertical, palms forward → wrists above elbows
  const LEFT_WRIST_X = LEFT_ELBOW_X;
  const RIGHT_WRIST_X = RIGHT_ELBOW_X;

  const legColor = variant === 'knees-caving' ? DANGER : TEAL;
  const armColor = variant === 'arms-dropped' ? DANGER : TEAL;

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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={variant === 'knees-caving' ? DANGER : AMBER} />
          </marker>
        </defs>

        {/* Floor */}
        <ellipse cx="180" cy="178" rx="150" ry="6" fill={`url(#${floorId})`} />
        <line x1="20" y1="178" x2="340" y2="178" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Reference: ideal knee X for valgus variant */}
        {variant === 'knees-caving' && (
          <g opacity="0.55">
            <circle cx={CX + 90} cy={KNEE_Y} r="5" fill="none" stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
            <circle cx={CX - 90} cy={KNEE_Y} r="5" fill="none" stroke={TEAL} strokeWidth="1.5" strokeDasharray="3 2" />
          </g>
        )}

        {/* Pelvis line */}
        <line
          x1={LEFT_HIP_X} y1={HIP_Y} x2={RIGHT_HIP_X} y2={HIP_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Spine — hip mid to shoulder mid */}
        <line
          x1={CX} y1={HIP_Y} x2={CX} y2={SHOULDER_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Shoulder line */}
        <line
          x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={RIGHT_SHOULDER_X} y2={SHOULDER_Y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Left leg (user's left, drawn on right side of frame because user faces camera) */}
        <line
          x1={LEFT_HIP_X} y1={HIP_Y} x2={LEFT_KNEE_X} y2={KNEE_Y}
          stroke={legColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={LEFT_KNEE_X} y1={KNEE_Y} x2={LEFT_ANKLE_X} y2={ANKLE_Y}
          stroke={legColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Right leg */}
        <line
          x1={RIGHT_HIP_X} y1={HIP_Y} x2={RIGHT_KNEE_X} y2={KNEE_Y}
          stroke={legColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={RIGHT_KNEE_X} y1={KNEE_Y} x2={RIGHT_ANKLE_X} y2={ANKLE_Y}
          stroke={legColor} strokeWidth="8" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Feet — turned out ~45°, drawn as short lines */}
        <line x1={LEFT_ANKLE_X - 6} y1={ANKLE_Y + 4} x2={LEFT_ANKLE_X + 18} y2={ANKLE_Y - 2}
          stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={RIGHT_ANKLE_X + 6} y1={ANKLE_Y + 4} x2={RIGHT_ANKLE_X - 18} y2={ANKLE_Y - 2}
          stroke={TEAL} strokeWidth="5" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Cactus arms — upper arm (shoulder → elbow) + forearm (elbow → wrist) */}
        {/* Left arm */}
        <line
          x1={LEFT_SHOULDER_X} y1={SHOULDER_Y} x2={LEFT_ELBOW_X} y2={ELBOW_Y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={LEFT_ELBOW_X} y1={ELBOW_Y} x2={LEFT_WRIST_X} y2={WRIST_Y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        {/* Right arm */}
        <line
          x1={RIGHT_SHOULDER_X} y1={SHOULDER_Y} x2={RIGHT_ELBOW_X} y2={ELBOW_Y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
        <line
          x1={RIGHT_ELBOW_X} y1={ELBOW_Y} x2={RIGHT_WRIST_X} y2={WRIST_Y}
          stroke={armColor} strokeWidth="6" strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Head */}
        <circle
          cx={CX} cy={HEAD_Y} r="13"
          fill="none" stroke={TEAL} strokeWidth="3.5"
          filter={`url(#${glowId})`}
        />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={LEFT_SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={RIGHT_SHOULDER_X} cy={SHOULDER_Y} r="3.5" />
          <circle cx={LEFT_ELBOW_X} cy={ELBOW_Y} r="3.5" />
          <circle cx={RIGHT_ELBOW_X} cy={ELBOW_Y} r="3.5" />
          <circle cx={LEFT_WRIST_X} cy={WRIST_Y} r="3" />
          <circle cx={RIGHT_WRIST_X} cy={WRIST_Y} r="3" />
          <circle cx={LEFT_HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={RIGHT_HIP_X} cy={HIP_Y} r="3.5" />
          <circle cx={LEFT_KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={RIGHT_KNEE_X} cy={KNEE_Y} r="3.5" />
          <circle cx={LEFT_ANKLE_X} cy={ANKLE_Y} r="3.5" />
          <circle cx={RIGHT_ANKLE_X} cy={ANKLE_Y} r="3.5" />
        </g>

        {/* Wrong-form annotations */}
        {variant === 'knees-caving' && (
          <g>
            <path d={`M ${CX + 90} ${KNEE_Y + 2} L ${LEFT_KNEE_X + 6} ${KNEE_Y + 2}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <path d={`M ${CX - 90} ${KNEE_Y + 2} L ${RIGHT_KNEE_X - 6} ${KNEE_Y + 2}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x={CX} y="196" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Knees caving inward
            </text>
          </g>
        )}
        {variant === 'arms-dropped' && (
          <g>
            <path d={`M ${LEFT_ELBOW_X} ${SHOULDER_Y} L ${LEFT_ELBOW_X} ${ELBOW_Y - 4}`}
              stroke={DANGER} strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
            <text x={CX} y="196" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
              Elbows dropped
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
