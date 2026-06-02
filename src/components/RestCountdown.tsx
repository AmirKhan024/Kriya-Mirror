'use client';
import { useEffect, useState } from 'react';
import type { SetRecord } from '@/store/workout';

interface Props {
  restEndsAt: number;
  setRecord: SetRecord;
  onSkip: () => void;
}

export function RestCountdown({ restEndsAt, setRecord, onSkip }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (now >= restEndsAt) onSkip();
  }, [now, restEndsAt, onSkip]);

  const remaining = Math.max(0, Math.ceil((restEndsAt - now) / 1000));

  return (
    <div className="absolute inset-0 bg-background/95 backdrop-blur z-30 flex flex-col items-center justify-center px-4">
      <div className="text-base sm:text-lg uppercase tracking-widest text-accent-teal mb-4 font-semibold">
        Set {setRecord.setNumber} complete
      </div>
      <div className="text-rest-xxl text-white tabular-nums leading-none">{remaining}</div>
      <div className="text-warning text-muted-foreground mt-3 mb-8">Rest, then continue</div>

      <div className="bg-overlay rounded-xl p-4 sm:p-6 mb-8 w-[92vw] max-w-sm sm:max-w-md">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Reps done</div>
            <div className="text-hud-md text-white tabular-nums">
              {setRecord.reps.length}/{setRecord.plannedReps}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Set MQS</div>
            <div className="text-hud-md text-accent-teal tabular-nums">{Math.round(setRecord.mqs)}</div>
          </div>
        </div>
      </div>

      <button
        onClick={onSkip}
        className="text-warning px-8 py-4 rounded-xl bg-accent-teal text-slate-900 font-bold hover:bg-accent-teal-hover transition active:scale-95"
      >
        Skip rest →
      </button>
    </div>
  );
}
