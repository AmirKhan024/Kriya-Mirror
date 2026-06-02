/** Completion: how wide did the clamshell open? */
export function getCompletionScore(peakOpenFrac: number): number {
  // MIN_REP_OPEN_FRAC = 0.22 → minimum valid
  // 0.40 = good; 0.60+ = excellent
  if (peakOpenFrac >= 0.60) return 100;
  if (peakOpenFrac >= 0.40) return 80 + ((peakOpenFrac - 0.40) / 0.20) * 20;
  if (peakOpenFrac >= 0.22) return 50 + ((peakOpenFrac - 0.22) / 0.18) * 30;
  return 30;
}

/** Smoothness: penalize fast knee velocity. */
export function getSmoothnessScore(velocities: number[]): number {
  if (velocities.length === 0) return 100;
  const maxV = Math.max(...velocities);
  if (maxV <= 0.8) return 100;
  if (maxV >= 1.5) return 0;
  return Math.round(100 - ((maxV - 0.8) / 0.7) * 100);
}

/** Form score: clamshell form is simple — no separate per-frame form metric needed. */
export function getFormScore(): number {
  return 100;
}

/** Composite MQS. */
export function computeMQS({ completion, smoothness }: { completion: number; smoothness: number }): number {
  return Math.round(0.6 * completion + 0.4 * smoothness);
}
