/**
 * Web Audio synthesis wrappers (Rule B: no sound stomps on itself).
 *
 * Each cue is a short oscillator burst with linear gain envelope.
 * Per-sound `lastPlayedAt` cooldown drops same-sound retriggers within 250 ms.
 * Different sounds are allowed to overlap (calibration beep + rep tick is fine).
 *
 * Mirrors the catalogue in
 * kriya-activities/mobility_new/deep_squat_descend/js/audio.js
 */
import { audioMute } from './preferences';

let _ctx: AudioContext | null = null;
const SAME_SOUND_COOLDOWN_MS = 250;
const lastPlayedAt: Record<string, number> = {};

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!_ctx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      _ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Browsers suspend AudioContext until a user gesture. Resume if suspended.
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => undefined);
  return _ctx;
}

function shouldDrop(id: string): boolean {
  if (audioMute.sound) return true;
  const now = performance.now();
  if (now - (lastPlayedAt[id] ?? 0) < SAME_SOUND_COOLDOWN_MS) return true;
  lastPlayedAt[id] = now;
  return false;
}

/** Single oscillator burst with linear attack/release envelope. */
function tone(opts: {
  freq: number;
  durationMs: number;
  type?: OscillatorType;
  startGain?: number;
  endGain?: number;
  startAt?: number;
}) {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime + (opts.startAt ?? 0);
  const dur = opts.durationMs / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.value = opts.freq;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(opts.startGain ?? 0.25, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(opts.endGain ?? 0.0001, now + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

/** Slide tone (start frequency → end frequency over duration). */
function slide(opts: {
  startFreq: number;
  endFreq: number;
  durationMs: number;
  type?: OscillatorType;
  gain?: number;
  startAt?: number;
}) {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime + (opts.startAt ?? 0);
  const dur = opts.durationMs / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// ─── Public cues ───────────────────────────────────────────────

export function playCalibrationBeep() {
  if (shouldDrop('cal')) return;
  tone({ freq: 800, durationMs: 200 });
}

export function playGoBeep() {
  if (shouldDrop('go')) return;
  tone({ freq: 600, durationMs: 300 });
}

export function playRepComplete() {
  if (shouldDrop('rep')) return;
  tone({ freq: 1000, durationMs: 80, startGain: 0.18 });
}

export function playSetComplete() {
  if (shouldDrop('set')) return;
  tone({ freq: 800, durationMs: 170 });
  tone({ freq: 1200, durationMs: 250, startAt: 0.18 });
}

export function playWarningBeep() {
  if (shouldDrop('warn')) return;
  tone({ freq: 400, durationMs: 200, type: 'square', startGain: 0.18 });
}

export function playRestStart() {
  if (shouldDrop('rest')) return;
  slide({ startFreq: 500, endFreq: 700, durationMs: 220 });
  slide({ startFreq: 600, endFreq: 900, durationMs: 220, startAt: 0.25 });
}

export function playRestEnd() {
  if (shouldDrop('rest-end')) return;
  tone({ freq: 700, durationMs: 100 });
  tone({ freq: 900, durationMs: 100, startAt: 0.12 });
  tone({ freq: 1200, durationMs: 200, startAt: 0.24 });
}

/** Unlock the AudioContext on first user gesture (most browsers require this). */
export function unlockAudio() {
  ctx();
}
