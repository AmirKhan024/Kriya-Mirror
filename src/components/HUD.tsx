interface HUDProps {
  currentSet: number;
  totalSets: number;
  repsThisSet: number;
  plannedReps: number;
  mqs: number;
  depthDeg: number;
}

/**
 * HUD — readable from 2 m away (Rule C).
 * Mobile (< sm): single compact top bar.
 * Desktop (≥ sm): split set-rep card (right) + MQS card (left), depth bar at bottom.
 * All overlay elements use `.bg-overlay` for high-contrast against the live camera feed.
 */
export function HUD({ currentSet, totalSets, repsThisSet, plannedReps, mqs, depthDeg }: HUDProps) {
  const depthPct = Math.max(0, Math.min(100, (depthDeg / 150) * 100));

  return (
    <>
      {/* Mobile: single top bar with everything inline */}
      <div className="absolute top-3 left-3 right-3 sm:hidden bg-overlay rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Set · Rep</div>
          <div className="text-hud-md text-white">
            {currentSet}/{totalSets}
            <span className="text-muted-foreground mx-2">·</span>
            {repsThisSet}/{plannedReps}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">MQS</div>
          <div className="text-hud-md text-accent-teal">{Math.round(mqs)}</div>
        </div>
      </div>

      {/* Desktop: left MQS card + right set/rep card */}
      <div className="hidden sm:block absolute top-6 right-6 bg-overlay rounded-xl px-6 py-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Set · Rep</div>
        <div className="text-hud-xl text-white tabular-nums">
          {currentSet}/{totalSets}
          <span className="text-muted-foreground mx-3">·</span>
          {repsThisSet}/{plannedReps}
        </div>
      </div>
      <div className="hidden sm:block absolute top-6 left-6 bg-overlay rounded-xl px-6 py-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Live MQS</div>
        <div className="text-hud-xl text-accent-teal tabular-nums">{Math.round(mqs)}</div>
      </div>

      {/* Depth bar — always at bottom, full-width on mobile, fixed-width on desktop */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(92vw,28rem)]">
        <div className="bg-overlay rounded-xl px-4 py-3">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Depth</span>
            <span className="text-xl font-bold text-white tabular-nums">{Math.round(depthDeg)}°</span>
          </div>
          <div className="h-3 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-teal to-accent-amber transition-all duration-100"
              style={{ width: `${depthPct}%` }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
