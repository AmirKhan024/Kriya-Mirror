// Re-export shared landmarks and visibility helper from squat/geometry
export { LM, lmVisible } from '@/modules/squat/geometry';

import type { NormalizedLandmark } from '@/modules/pose/types';

/**
 * Compute the thigh lift angle of the hip→knee vector from "straight down" (0°).
 * 0° = knee directly below hip (at-rest quadruped position).
 * 90° = knee at hip level, pointing backward (full donkey kick, thigh parallel to floor).
 *
 * In MediaPipe coords: Y=0 is top, Y=1 is bottom.
 * At rest (kneeling, knee directly below hip): hip.y < knee.y → thighLiftDeg ≈ 0°
 * At peak kick (thigh horizontal, heel at ceiling): hip.y ≈ knee.y → thighLiftDeg ≈ 80-90°
 */
export function thighLiftDeg(hip: NormalizedLandmark, knee: NormalizedLandmark): number {
  const dx = Math.abs(knee.x - hip.x);  // horizontal distance (how far back knee has moved)
  const dy = knee.y - hip.y;            // positive when knee is below hip (normal resting position)
  // atan2(dx, dy): 0 when dx=0,dy>0 (pointing down); 90° when dx>0,dy=0 (pointing sideways)
  return Math.max(0, Math.atan2(dx, dy) * (180 / Math.PI));
}
