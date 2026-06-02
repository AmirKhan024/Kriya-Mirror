/**
 * SpeechSynthesis wrapper — non-preemptive FIFO queue (Rule B).
 *
 * Hard rules:
 *  - Once an utterance starts speaking, it FINISHES. No mid-utterance cancel
 *    during normal flow.
 *  - Single pending slot. Incoming utterances are queued only if their priority
 *    strictly exceeds the pending one; otherwise dropped silently.
 *  - Only `high` priority may interrupt a currently-speaking lower-priority
 *    utterance, and even then we wait for the next word boundary before
 *    calling cancel() so we never chop mid-word.
 *  - Per-message-key rate limit (4 s) so we don't spam the same correction.
 */
import { audioMute } from './preferences';

export type VoicePriority = 'low' | 'normal' | 'high';

interface QueuedUtterance {
  text: string;
  priority: VoicePriority;
  key?: string;          // for rate-limiting same-message repeats
}

const PRIO_RANK: Record<VoicePriority, number> = { low: 1, normal: 2, high: 3 };
const REPEAT_COOLDOWN_MS = 4000;

let currentlySpeaking: { utt: SpeechSynthesisUtterance; priority: VoicePriority; lastWordEndAt: number } | null = null;
let pending: QueuedUtterance | null = null;
const lastSaidAt: Record<string, number> = {};
// 2026-05-31: keys that have already had a forced (navigation) utterance fire.
// The FIRST forced fire of a key bypasses the per-key cooldown so a navigation
// cue (position-lost / too-far / too-close / not-moving) is never swallowed by
// a cooldown set moments earlier (e.g. the same hint spoken during calibration).
// Anti-spam still applies to every subsequent fire of that key.
const forcedKeysFired = new Set<string>();

function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function speakNow(q: QueuedUtterance) {
  if (!speechAvailable()) return;
  const utt = new SpeechSynthesisUtterance(q.text);
  utt.rate = 1.05;
  utt.pitch = 1.0;
  utt.volume = 1.0;
  utt.lang = 'en-US';

  currentlySpeaking = { utt, priority: q.priority, lastWordEndAt: performance.now() };

  utt.onboundary = () => {
    if (currentlySpeaking?.utt === utt) {
      currentlySpeaking.lastWordEndAt = performance.now();
    }
  };
  utt.onend = () => {
    if (currentlySpeaking?.utt === utt) currentlySpeaking = null;
    drainPending();
  };
  utt.onerror = () => {
    if (currentlySpeaking?.utt === utt) currentlySpeaking = null;
    drainPending();
  };

  window.speechSynthesis.speak(utt);
}

function drainPending() {
  if (!pending || currentlySpeaking) return;
  const next = pending;
  pending = null;
  speakNow(next);
}

/**
 * Enqueue an utterance. Honors the no-cutoff rule.
 *
 * `opts.force = true` makes the utterance always claim the pending slot
 * (replacing whatever was there at equal-or-lower priority). Reserved for
 * safety-critical warnings like `position-lost` where the user is OUT of
 * camera and may not see the on-screen chip — they need the voice cue.
 * The 4 s per-key cooldown still applies, so this can't be abused for spam.
 */
export function speak(
  text: string,
  priority: VoicePriority = 'normal',
  key?: string,
  opts?: { force?: boolean },
) {
  if (audioMute.voice) return;
  if (!speechAvailable()) return;

  if (key) {
    const last = lastSaidAt[key] ?? 0;
    const now = performance.now();
    // First forced fire of a key skips the cooldown so the navigation cue is
    // never dropped; all other fires honor the 4 s per-key anti-spam window.
    const firstForcedFire = !!opts?.force && !forcedKeysFired.has(key);
    if (!firstForcedFire && now - last < REPEAT_COOLDOWN_MS) return;
    lastSaidAt[key] = now;
    if (opts?.force) forcedKeysFired.add(key);
  }

  const incoming: QueuedUtterance = { text, priority, key };

  // Case 1: nothing speaking → speak immediately
  if (!currentlySpeaking) {
    speakNow(incoming);
    return;
  }

  // Case 2: high-priority safety interrupt while a LOWER priority is speaking
  if (
    priority === 'high'
    && PRIO_RANK[priority] > PRIO_RANK[currentlySpeaking.priority]
  ) {
    // Wait for next word boundary, then cancel + speak
    waitForWordBoundary(() => {
      window.speechSynthesis.cancel();
      currentlySpeaking = null;
      speakNow(incoming);
    });
    return;
  }

  // Case 3a (force): always claim the pending slot at equal-or-higher
  // priority. Reserved for safety-critical warnings (see opts docs above).
  if (opts?.force) {
    if (!pending || PRIO_RANK[priority] >= PRIO_RANK[pending.priority]) {
      pending = incoming;
    }
    return;
  }

  // Case 3b: normal pending-slot rule — only replace if STRICTLY higher
  // than the queued one.
  if (!pending || PRIO_RANK[priority] > PRIO_RANK[pending.priority]) {
    pending = incoming;
  }
  // Otherwise drop silently
}

function waitForWordBoundary(then: () => void, maxWaitMs = 600) {
  if (!currentlySpeaking) { then(); return; }
  const start = performance.now();
  const tick = () => {
    if (!currentlySpeaking) { then(); return; }
    const sinceLastWord = performance.now() - currentlySpeaking.lastWordEndAt;
    if (sinceLastWord < 60 || performance.now() - start > maxWaitMs) {
      then();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Hard stop everything — used on unmount. Finishes current word first when possible. */
export function shutdownVoice() {
  if (!speechAvailable()) return;
  pending = null;
  waitForWordBoundary(() => {
    window.speechSynthesis.cancel();
    currentlySpeaking = null;
  });
}
