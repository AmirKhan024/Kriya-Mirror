/**
 * Sit-to-Stand scoring — mirrors squat's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on the knee-extension RANGE this rep (seated flexion −
 * standing flexion). A full sit-to-stand covers ~85–90° of knee extension
 * (seated ~90° → standing ~5°).
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by knee-extension range (degrees). */
export function getCompletionScore(rangeDeg: number): number {
  if (rangeDeg >= 75) return 100;
  if (rangeDeg >= 60) return 85;
  if (rangeDeg >= 45) return 70;
  if (rangeDeg >= 35) return 55;   // floor — below this the rep didn't count upstream
  return 30;
}
