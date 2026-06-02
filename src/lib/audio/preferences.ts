'use client';
import { useEffect, useState, useCallback } from 'react';

const SOUND_KEY = 'kriya-mirror:audio:sound-muted';
const VOICE_KEY = 'kriya-mirror:audio:voice-muted';

export interface AudioPreferences {
  soundMuted: boolean;
  voiceMuted: boolean;
  toggleSound: () => void;
  toggleVoice: () => void;
}

/** Reads + persists 🔊 sound and 🗣 voice toggles independently. */
export function useAudioPreferences(): AudioPreferences {
  const [soundMuted, setSoundMuted] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSoundMuted(localStorage.getItem(SOUND_KEY) === '1');
    setVoiceMuted(localStorage.getItem(VOICE_KEY) === '1');
  }, []);

  const toggleSound = useCallback(() => {
    setSoundMuted((m) => {
      const next = !m;
      if (typeof window !== 'undefined') {
        localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceMuted((m) => {
      const next = !m;
      if (typeof window !== 'undefined') {
        localStorage.setItem(VOICE_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);

  return { soundMuted, voiceMuted, toggleSound, toggleVoice };
}

/** Module-level mirrors so cues.ts / voice.ts can read mute without React. */
export const audioMute = {
  sound: false,
  voice: false,
};

export function syncAudioMuteFromStorage() {
  if (typeof window === 'undefined') return;
  audioMute.sound = localStorage.getItem(SOUND_KEY) === '1';
  audioMute.voice = localStorage.getItem(VOICE_KEY) === '1';
}

export function setSoundMutedExternal(muted: boolean) { audioMute.sound = muted; }
export function setVoiceMutedExternal(muted: boolean) { audioMute.voice = muted; }
