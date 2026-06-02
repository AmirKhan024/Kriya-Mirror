/**
 * Standing Oblique Side Bend scoring — mirrors high-knees / squat MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on peak lateral-lean LIFT (degrees). Lateral spinal
 * flexion ROM is ~0–35°, so the tiers are set accordingly:
 *   - 30+ ≈ a full, controlled side bend
 *   - 18  ≈ the minimum that counts (MIN_REP_LEAN_DEG)
 *   - < 18 fails the rep-validation gate upstream → incomplete-bend.
 *
 * Form is single-factor here (the whole movement is the torso, so there's no
 * separate torso-stability term) — it defaults to full marks for a counted rep.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak lateral-lean lift (degrees). */
export function getCompletionScore(peakLeanDeg: number): number {
  if (peakLeanDeg >= 30) return 100;
  if (peakLeanDeg >= 25) return 85;
  if (peakLeanDeg >= 21) return 70;
  if (peakLeanDeg >= 18) return 55;   // floor — below MIN_REP_LEAN fails upstream
  if (peakLeanDeg >= 10) return 25;
  return 0;
}
