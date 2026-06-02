/**
 * Warning audio-emission policy.
 *
 * By default `handleWarning` only fires `speak()` audio on the SECOND+
 * occurrence of a warning type within a set — gives the user a "free pass"
 * on the first occurrence of any FORM warning before audibly nagging.
 *
 * But NAVIGATION warnings (the user is out of frame, too close/far, or has
 * stopped moving) need IMMEDIATE audio — the user often can't see the chip
 * because they're out of position. For these, fire audio on first occurrence.
 *
 * Round 19 fix (2026-05-28): introduced because users reported
 *   "position-lost text comes after 3 s but audio comes much later (~13 s)"
 * — the engine fires `position-lost` every 10 s while still lost, so the
 * SECOND fire (when audio kicked in under the old policy) landed at ~13 s.
 */
import type { WarningType } from '@/store/workout';

/** Warnings that require IMMEDIATE audio on the first occurrence (not just
 *  on the 2nd+). User must physically reposition or start moving to clear
 *  them — they may not be looking at the screen.
 *
 *  2026-05-31: `handleWarning` also passes `force: true` to `speak()` for
 *  every type in this set, so the spoken cue claims the voice pending slot
 *  and bypasses the per-key cooldown on its first fire — guaranteeing the
 *  audio co-fires with the on-screen chip + beep instead of being delayed. */
export const IMMEDIATE_AUDIO_WARNINGS: ReadonlySet<WarningType> = new Set<WarningType>([
  'position-lost',
  'too-close',
  'too-far',
  'not-moving',
]);

/** Decide whether `speak()` should fire for a given warning at a given
 *  per-set occurrence count.
 *
 *  @param type   The warning type (e.g. 'position-lost', 'incomplete-curl')
 *  @param occurrence  How many times this warning has fired in the current set (1-indexed)
 *  @returns true if `speak()` should fire now, false to stay silent (chip only)
 */
export function shouldSpeakNow(type: WarningType, occurrence: number): boolean {
  if (IMMEDIATE_AUDIO_WARNINGS.has(type)) return true;
  // 2026-05-31 (physical-test feedback): speak FORM warnings on the FIRST
  // occurrence too, so users get spoken + on-screen guidance the moment a fault
  // happens (previously they only got a silent chip until the 2nd occurrence —
  // reverse-lunge testers reported "no audio at all"). This stays MILD, not
  // spammy: the voice layer enforces a 4 s per-key cooldown and Rule A shows at
  // most one chip at a time, so a given cue speaks at most once every few
  // seconds regardless of how often the engine emits it.
  return occurrence >= 1;
}
