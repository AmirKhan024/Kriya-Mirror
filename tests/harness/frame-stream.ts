import type { PoseLandmarks } from '@/modules/pose/types';
import type { Frame } from './types';

/**
 * Build a time-keyed frame array from an intent function.
 *
 *   buildFrames(
 *     (tMs) => ({ kneeFlexionDeg: tMs > 5000 ? 90 : 0, ... }),
 *     buildSquatPose,
 *     { fps: 30, durationMs: 10_000 },
 *   )
 *
 * If the intent function returns `null`, the produced frame has `landmarks: null`
 * (simulates pose loss).
 */
export function buildFrames<TIntent>(
  intentAt: (tMs: number) => TIntent | null,
  poseBuilder: (intent: TIntent) => PoseLandmarks,
  opts: { fps: number; durationMs: number; startAt?: number },
): Frame[] {
  const { fps, durationMs, startAt = 0 } = opts;
  const dt = 1000 / fps;
  const frames: Frame[] = [];
  for (let t = 0; t < durationMs; t += dt) {
    const tMs = startAt + t;
    const intent = intentAt(t);
    frames.push({
      landmarks: intent === null ? null : poseBuilder(intent),
      tMs,
    });
  }
  return frames;
}

/** Concatenate frame segments. Each segment is shifted to start where the previous ended. */
export function concatFrames(...segments: Frame[][]): Frame[] {
  const out: Frame[] = [];
  let offset = 0;
  for (const seg of segments) {
    if (seg.length === 0) continue;
    const firstT = seg[0].tMs;
    for (const f of seg) out.push({ landmarks: f.landmarks, tMs: f.tMs - firstT + offset });
    offset = out[out.length - 1].tMs + (1000 / 30); // assume next segment starts one frame later
  }
  return out;
}
