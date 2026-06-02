'use client';
import { useEffect, useState } from 'react';

interface Props {
  /** Seconds elapsed since calibration confirmed */
  secondsElapsed: number;
  /** Target hold duration in seconds */
  targetDurationSec: number;
  /** Live form score 0–100 */
  formScore: number;
  /** True after the hold ends (target met or broken) */
  finished?: boolean;
}

/**
 * Big-font hold timer for static-hold exercises.
 * Readable from 2m (Rule C): timer uses `text-rest-xxl` (96 px), form bar 24 px.
 * Mobile + desktop share the same layout (single big overlay top-center).
 */
export function HoldTimer({ secondsElapsed, targetDurationSec, formScore, finished }: Props) {
  const [, force] = useState(0);
  // Re-render every 200 ms to keep the visual countdown feeling alive even
  // between engine ticks (which arrive every 1 s).
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 200);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, targetDurationSec - secondsElapsed);
  const progress = Math.min(100, (secondsElapsed / Math.max(1, targetDurationSec)) * 100);
  const formPct = Math.max(0, Math.min(100, formScore));

  return (
    <>
      {/* Big timer overlay, top-center */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 sm:top-6 bg-overlay rounded-2xl px-4 py-3 sm:px-6 sm:py-4 text-center min-w-[260px] sm:min-w-[280px]">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          {finished ? 'Hold complete' : 'Hold for'}
        </div>
        <div className="text-6xl sm:text-rest-xxl text-white tabular-nums leading-none">
          {remaining}
          <span className="text-warning text-muted-foreground ml-2">s</span>
        </div>
        <div className="text-xs text-muted mt-1 tabular-nums">
          {secondsElapsed}s / {targetDurationSec}s
        </div>
      </div>

      {/* Progress + form bar — bottom-center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(92vw,28rem)]">
        <div className="bg-overlay rounded-xl px-4 py-3 space-y-3">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Time</span>
              <span className="text-xl font-bold text-white tabular-nums">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-teal transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Form</span>
              <span className="text-xl font-bold text-accent-teal tabular-nums">{Math.round(formPct)}</span>
            </div>
            <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  formPct >= 75 ? 'bg-accent-teal' : formPct >= 50 ? 'bg-accent-amber' : 'bg-accent-danger'
                }`}
                style={{ width: `${formPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
