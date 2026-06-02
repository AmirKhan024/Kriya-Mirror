/** Completion: how far did the user lean? Min valid = 40°, excellent = 75°+. */
export function getCompletionScore(peakLeanDeg: number): number {
  if (peakLeanDeg >= 75) return 100;
  if (peakLeanDeg >= 60) return 80 + ((peakLeanDeg - 60) / 15) * 20;
  if (peakLeanDeg >= 40) return 50 + ((peakLeanDeg - 40) / 20) * 30;
  return 30;
}

/** Smoothness: penalize high trunk velocities. */
export function getSmoothnessScore(velocities: number[]): number {
  if (velocities.length === 0) return 100;
  const maxV = Math.max(...velocities);
  if (maxV <= 1.0) return 100;
  if (maxV >= 2.5) return 0;
  return Math.round(100 - ((maxV - 1.0) / 1.5) * 100);
}

/** Form score: no form errors for basic Nordic Curl (no extra posture warnings). */
export function getFormScore(): number {
  return 100; // Nordic curl form is binary (either you do it or you don't)
}

/** Composite MQS: weighted average. */
export function computeMQS({ completion, smoothness }: { completion: number; smoothness: number }): number {
  return Math.round(0.6 * completion + 0.4 * smoothness);
}
