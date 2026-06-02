/**
 * Star Pose scoring — pure balance hold. Form score is driven entirely by
 * CoM-proxy sway, using the same clinical sway bands as Tandem Stand /
 * Single Leg Stand (re-exported). The star arms + extended leg are coached
 * separately (guidance cues) and do NOT enter the score — mirrors the BB10
 * reference where star form never penalizes the balance metric.
 */
export { getSwayPenalty } from '@/modules/tandem-stand/scoring';
