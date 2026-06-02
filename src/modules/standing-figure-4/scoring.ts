/**
 * Standing Figure-4 scoring — same sway + hip-tilt + foot-off-leg penalty
 * primitives as Tree Pose (the crossed-ankle-on-knee is geometrically the same
 * single-leg balance + foot-on-leg problem).
 */
export { getSwayPenalty } from '@/modules/tandem-stand/scoring';
export { getHipTiltPenalty } from '@/modules/single-leg-stand/scoring';
export { getFootOffLegPenalty } from '@/modules/tree-pose/scoring';
