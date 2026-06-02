'use client';
import { useState, useEffect } from 'react';
import type { ExerciseConfig } from '@/config/exercises/types';

/** Returns the YouTube video id if the URL is a YouTube link, otherwise null. */
function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  // Matches: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function VideoAudioMode({ exercise }: { exercise: ExerciseConfig }) {
  const storageKey = `kriya-mirror:videoUrl:${exercise.id}`;
  const [userUrl, setUserUrl] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) setUserUrl(saved);
  }, [storageKey]);

  function save() {
    localStorage.setItem(storageKey, userUrl);
  }

  const effectiveUrl = exercise.videoUrl ?? userUrl;
  const youtubeId = extractYouTubeId(effectiveUrl);

  return (
    <div className="card p-6 sm:p-8">
      {effectiveUrl ? (
        <>
          {youtubeId ? (
            <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black mx-auto max-w-2xl">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1`}
                title={`${exercise.name} demonstration`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            </div>
          ) : (
            <video
              src={effectiveUrl}
              controls
              className="w-full max-w-2xl mx-auto rounded-lg"
            />
          )}
          <p className="text-sm text-muted-foreground text-center mt-4">
            Watch the demonstration, then switch to <strong className="text-accent-teal">Camera Vision</strong> to try it yourself.
          </p>
        </>
      ) : (
        <div className="text-center">
          <div className="text-5xl mb-4">🎬</div>
          <h3 className="text-xl font-semibold text-white mb-2">No video added yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Paste a YouTube link below to watch a demonstration of this exercise. The link is saved
            only on this device.
          </p>
          <div className="max-w-md mx-auto">
            <div className="flex gap-2">
              <input
                type="url"
                value={userUrl}
                onChange={(e) => setUserUrl(e.target.value)}
                placeholder="https://youtube.com/..."
                className="flex-1 px-3 py-2 rounded bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:border-accent-teal-border"
              />
              <button
                onClick={save}
                className="px-4 py-2 rounded bg-accent-teal text-slate-900 text-sm font-semibold hover:bg-accent-teal-hover"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
