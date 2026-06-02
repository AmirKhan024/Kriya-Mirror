// MediaPipe landmark indices
export const LEFT_SHOULDER  = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_HIP       = 23;
export const RIGHT_HIP      = 24;
export const LEFT_KNEE      = 25;
export const RIGHT_KNEE     = 26;
export const LEFT_ANKLE     = 27;
export const RIGHT_ANKLE    = 28;
export const LEFT_WRIST     = 15;
export const RIGHT_WRIST    = 16;

export function lmVisible(lm: { visibility?: number } | undefined): lm is { x: number; y: number; visibility: number } {
  return (lm?.visibility ?? 0) > 0.5;
}

/** Angle at the knee vertex in a hip→knee→ankle triangle (degrees).
 *  ~90° when leg is bent at rest, ~160°+ when leg is fully extended. */
export function hipKneeAngleDeg(
  hip: { x: number; y: number },
  knee: { x: number; y: number },
  ankle: { x: number; y: number },
): number {
  const khX = hip.x - knee.x;
  const khY = hip.y - knee.y;
  const kaX = ankle.x - knee.x;
  const kaY = ankle.y - knee.y;
  const dot = khX * kaX + khY * kaY;
  const mag = Math.sqrt(khX ** 2 + khY ** 2) * Math.sqrt(kaX ** 2 + kaY ** 2);
  if (mag < 1e-6) return 90;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}
