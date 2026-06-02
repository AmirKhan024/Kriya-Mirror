/**
 * Single Leg Stand scoring — same clinical sway-band approach as Tandem Stand
 * (re-exported), plus a hip-tilt penalty unique to single-leg holds.
 */
export { getSwayPenalty, getTrunkPenalty } from '@/modules/tandem-stand/scoring';

/**
 * Hip-tilt penalty — the lifted-side hip should stay at roughly the same y
 * as the standing-side hip. If it drops (positive `hipDropAmount`), penalize
 * proportionally up to a 30-point cap.
 */
export function getHipTiltPenalty(hipDropAmount: number, shoulderWidth: number): number {
  if (shoulderWidth <= 0) return 0;
  const normalizedDrop = hipDropAmount / shoulderWidth;
  // Drop of 0.15 (the warning threshold) starts the penalty curve; full 30
  // points at 0.30 drop.
  const excess = Math.max(0, normalizedDrop - 0.15);
  return Math.min(30, excess * 200);
}

// (No `computeFormScore` aggregator here — the engine inlines the calculation
// directly using `getSwayPenalty` from Tandem Stand + the local `getHipTiltPenalty`.
// Keeping this file focused on the penalty primitives.)
