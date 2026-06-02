/**
 * Unit tests for the Round 19 voice/text sync fix.
 *
 * `shouldSpeakNow(type, occurrence)` decides whether `speak()` should fire
 * for a warning at a given per-set occurrence count.
 *
 * Policy (round 19):
 *   - Navigation warnings (position-lost, too-close, too-far, not-moving)
 *     fire audio on FIRST occurrence — user is out of position and may not
 *     see the chip.
 *   - All other (form) warnings fire audio on 2nd+ occurrence only — gives
 *     the user a "free pass" on the first to learn without nagging.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldSpeakNow,
  IMMEDIATE_AUDIO_WARNINGS,
} from '@/lib/audio/warning-policy';

describe('warning-policy: shouldSpeakNow', () => {
  describe('navigation warnings — audio on FIRST occurrence', () => {
    it('fires audio for position-lost on first occurrence', () => {
      expect(shouldSpeakNow('position-lost', 1)).toBe(true);
    });
    it('fires audio for too-close on first occurrence', () => {
      expect(shouldSpeakNow('too-close', 1)).toBe(true);
    });
    it('fires audio for too-far on first occurrence', () => {
      expect(shouldSpeakNow('too-far', 1)).toBe(true);
    });
    it('fires audio for not-moving on first occurrence', () => {
      expect(shouldSpeakNow('not-moving', 1)).toBe(true);
    });
    it('continues to fire audio for navigation warnings on repeats', () => {
      expect(shouldSpeakNow('position-lost', 2)).toBe(true);
      expect(shouldSpeakNow('position-lost', 5)).toBe(true);
    });
  });

  // 2026-05-31 policy (physical-test feedback): form warnings now SPEAK from the
  // first occurrence too (testers reported "no audio at all" for some faults).
  // It stays mild — the voice layer enforces a per-key cooldown + single-chip
  // rule, so a cue speaks at most once every few seconds however often it fires.
  describe('form warnings — audio from the first occurrence (mild, throttled)', () => {
    it('speaks on first occurrence of incomplete-curl', () => {
      expect(shouldSpeakNow('incomplete-curl', 1)).toBe(true);
    });
    it('still speaks on second occurrence of incomplete-curl', () => {
      expect(shouldSpeakNow('incomplete-curl', 2)).toBe(true);
    });
    it('speaks on first occurrence of hip-sag', () => {
      expect(shouldSpeakNow('hip-sag', 1)).toBe(true);
    });
    it('speaks on first occurrence of arms-too-high', () => {
      expect(shouldSpeakNow('arms-too-high', 1)).toBe(true);
    });
    it('still speaks on second occurrence of arms-too-high', () => {
      expect(shouldSpeakNow('arms-too-high', 2)).toBe(true);
    });
    it('speaks on first occurrence of front-knee-not-bent-enough', () => {
      expect(shouldSpeakNow('front-knee-not-bent-enough', 1)).toBe(true);
    });
  });

  describe('IMMEDIATE_AUDIO_WARNINGS set contents', () => {
    it('contains exactly the four navigation warning types', () => {
      expect(IMMEDIATE_AUDIO_WARNINGS.size).toBe(4);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('position-lost')).toBe(true);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('too-close')).toBe(true);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('too-far')).toBe(true);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('not-moving')).toBe(true);
    });
    it('does NOT contain any form warning', () => {
      expect(IMMEDIATE_AUDIO_WARNINGS.has('incomplete-curl')).toBe(false);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('hip-sag')).toBe(false);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('arms-too-high')).toBe(false);
      expect(IMMEDIATE_AUDIO_WARNINGS.has('arms-not-overhead')).toBe(false);
    });
  });
});
