'use client';
import { useState } from 'react';
import type { ExerciseConfig } from '@/config/exercises/types';
import { ImageTextMode } from './ImageTextMode';
import { VideoAudioMode } from './VideoAudioMode';
import { CameraVisionGateway } from './CameraVisionGateway';

type Mode = 'image-text' | 'video-audio' | 'camera-vision';

export function ModeTabs({ exercise }: { exercise: ExerciseConfig }) {
  const [mode, setMode] = useState<Mode>('image-text');

  const tabs: { id: Mode; label: string; icon: string; enabled: boolean }[] = [
    { id: 'image-text', label: 'Image + Text', icon: '📸', enabled: exercise.guidanceModes.imageText },
    { id: 'video-audio', label: 'Video + Audio', icon: '🎬', enabled: true },
    { id: 'camera-vision', label: 'Camera Vision', icon: '📷', enabled: exercise.guidanceModes.cameraVision !== 'none' },
  ];

  return (
    <div>
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => t.enabled && setMode(t.id)}
            disabled={!t.enabled}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap border ${
              mode === t.id
                ? 'bg-accent-teal text-slate-900 border-accent-teal'
                : t.enabled
                  ? 'bg-surface-2 text-foreground border-surface-3 hover:border-accent-teal-border'
                  : 'bg-surface text-muted border-surface-2 cursor-not-allowed'
            }`}
          >
            <span className="mr-2">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'image-text' && <ImageTextMode exercise={exercise} />}
      {mode === 'video-audio' && <VideoAudioMode exercise={exercise} />}
      {mode === 'camera-vision' && <CameraVisionGateway exercise={exercise} />}
    </div>
  );
}
