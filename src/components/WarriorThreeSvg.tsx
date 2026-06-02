'use client';
import { useId } from 'react';

/**
 * Warrior III stickman — side-on "airplane T" view, three variants:
 *   hero      — correct: standing leg vertical, torso + back leg level (horizontal),
 *               arms reaching forward
 *   torso-up  — wrong: torso too upright (not hinged into the T)
 *   leg-down  — wrong: back leg dropped toward the floor
 *
 * Each limb is an individual <line> (no polyline — see PlankSvg).
 */
type Variant = 'hero' | 'torso-up' | 'leg-down';

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

export function WarriorThreeSvg({ variant = 'hero', className, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `w3-glow-${uid}`;
  const floorId = `w3-floor-${uid}`;

  // Hip = the central pivot. Standing leg drops straight down to the floor.
  const HIP = { x: 180, y: 95 };
  const STANDING_KNEE = { x: 180, y: 135 };
  const STANDING_ANKLE = { x: 180, y: 175 };

  // Torso reaches FORWARD (right) toward horizontal — or stays upright (wrong).
  const torsoUp = variant === 'torso-up';
  const SHOULDER = torsoUp ? { x: 196, y: 50 } : { x: 250, y: 88 };
  const HEAD = torsoUp ? { x: 200, y: 30 } : { x: 274, y: 83 };
  // Arms reach forward past the shoulder.
  const ELBOW = torsoUp ? { x: 210, y: 60 } : { x: 276, y: 92 };
  const WRIST = torsoUp ? { x: 224, y: 66 } : { x: 302, y: 96 };

  // Back leg reaches BACK (left) toward horizontal — or droops down (wrong).
  const legDown = variant === 'leg-down';
  const BACK_KNEE = legDown ? { x: 142, y: 120 } : { x: 132, y: 96 };
  const BACK_ANKLE = legDown ? { x: 120, y: 158 } : { x: 88, y: 92 };

  const torsoColor = torsoUp ? DANGER : TEAL;
  const backLegColor = legDown ? DANGER : TEAL;

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
        <ellipse cx="180" cy="182" rx="120" ry="5" fill={`url(#${floorId})`} />
        <line x1="40" y1="182" x2="320" y2="182" stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* Standing leg (vertical) */}
        <line x1={HIP.x} y1={HIP.y} x2={STANDING_KNEE.x} y2={STANDING_KNEE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={STANDING_KNEE.x} y1={STANDING_KNEE.y} x2={STANDING_ANKLE.x} y2={STANDING_ANKLE.y}
          stroke={TEAL} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Back leg (reaching back, level) */}
        <line x1={HIP.x} y1={HIP.y} x2={BACK_KNEE.x} y2={BACK_KNEE.y}
          stroke={backLegColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={BACK_KNEE.x} y1={BACK_KNEE.y} x2={BACK_ANKLE.x} y2={BACK_ANKLE.y}
          stroke={backLegColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Torso (hip → shoulder, reaching forward + level) */}
        <line x1={HIP.x} y1={HIP.y} x2={SHOULDER.x} y2={SHOULDER.y}
          stroke={torsoColor} strokeWidth="8" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Arms (reaching forward) */}
        <line x1={SHOULDER.x} y1={SHOULDER.y} x2={ELBOW.x} y2={ELBOW.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />
        <line x1={ELBOW.x} y1={ELBOW.y} x2={WRIST.x} y2={WRIST.y}
          stroke={TEAL} strokeWidth="6" strokeLinecap="round" filter={`url(#${glowId})`} />

        {/* Head */}
        <circle cx={HEAD.x} cy={HEAD.y} r="12" fill="none" stroke={TEAL} strokeWidth="3.5" filter={`url(#${glowId})`} />

        {/* Joint dots */}
        <g fill={AMBER}>
          <circle cx={HIP.x} cy={HIP.y} r="3.5" />
          <circle cx={STANDING_KNEE.x} cy={STANDING_KNEE.y} r="3.5" />
          <circle cx={STANDING_ANKLE.x} cy={STANDING_ANKLE.y} r="3.5" />
          <circle cx={BACK_KNEE.x} cy={BACK_KNEE.y} r="3.5" />
          <circle cx={BACK_ANKLE.x} cy={BACK_ANKLE.y} r="3.5" />
          <circle cx={SHOULDER.x} cy={SHOULDER.y} r="3.5" />
          <circle cx={WRIST.x} cy={WRIST.y} r="3.5" />
        </g>

        {/* Wrong-form annotations */}
        {variant === 'torso-up' && (
          <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
            Hinge into a level T
          </text>
        )}
        {variant === 'leg-down' && (
          <text x="180" y="197" fontSize="12" fill={DANGER} textAnchor="middle" fontWeight="700">
            Lift the back leg higher
          </text>
        )}
      </svg>
      {label && (
        <p className="text-center text-sm text-muted-foreground mt-2">{label}</p>
      )}
    </div>
  );
}
