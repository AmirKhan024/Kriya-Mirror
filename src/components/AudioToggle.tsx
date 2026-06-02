'use client';
import { useAudioPreferences, setSoundMutedExternal, setVoiceMutedExternal } from '@/lib/audio/preferences';
import { useEffect } from 'react';

/**
 * Bottom-right 🔊 / 🗣 toggle pair. Each persists to localStorage and
 * mirrors into the module-level audioMute flag read by cues.ts / voice.ts.
 */
export function AudioToggle() {
  const { soundMuted, voiceMuted, toggleSound, toggleVoice } = useAudioPreferences();

  useEffect(() => { setSoundMutedExternal(soundMuted); }, [soundMuted]);
  useEffect(() => { setVoiceMutedExternal(voiceMuted); }, [voiceMuted]);

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={toggleSound}
        aria-label={soundMuted ? 'Unmute sound' : 'Mute sound'}
        className={`w-11 h-11 rounded-lg flex items-center justify-center text-lg bg-overlay ${
          soundMuted ? 'opacity-50' : ''
        }`}
        title={soundMuted ? 'Sound off' : 'Sound on'}
      >
        {soundMuted ? '🔇' : '🔊'}
      </button>
      <button
        type="button"
        onClick={toggleVoice}
        aria-label={voiceMuted ? 'Unmute voice' : 'Mute voice'}
        className={`w-11 h-11 rounded-lg flex items-center justify-center text-lg bg-overlay ${
          voiceMuted ? 'opacity-50' : ''
        }`}
        title={voiceMuted ? 'Voice off' : 'Voice on'}
      >
        {voiceMuted ? '🤐' : '🗣'}
      </button>
    </div>
  );
}
