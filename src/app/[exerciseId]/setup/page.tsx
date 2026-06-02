'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getExerciseById } from '@/config/exercises';
import { useWorkout } from '@/store/workout';
import { HeroIllustration } from '@/components/HeroIllustration';
import { PrivacyBadge } from '@/components/PrivacyBadge';

export default function SetupPage({ params }: { params: { exerciseId: string } }) {
  const router = useRouter();
  const exercise = getExerciseById(params.exerciseId);
  const initWorkout = useWorkout((s) => s.initWorkout);

  if (!exercise) notFound();
  const isHold = exercise.exerciseType === 'hold-based';

  const [sets, setSets] = useState(exercise.defaultSets || 3);
  const [reps, setReps] = useState(exercise.defaultRepsPerSet || 10);
  const [restSec, setRestSec] = useState(exercise.defaultRestSec || 60);
  const [weight, setWeight] = useState(0);
  const [holdSec, setHoldSec] = useState(exercise.defaultHoldDurationSec || 30);
  const [acknowledged, setAcknowledged] = useState<boolean[]>(
    exercise.safetyChecks.map(() => false),
  );

  const allAck = acknowledged.every(Boolean);
  const minHold = exercise.minHoldDurationSec ?? 5;
  const valid = isHold
    ? (allAck && holdSec >= minHold)
    : (allAck && sets > 0 && reps > 0 && restSec >= 0);

  function start() {
    if (!exercise || !valid) return;
    initWorkout(exercise, isHold
      ? { holdDurationSec: holdSec }
      : {
        plannedSets: sets,
        plannedRepsPerSet: reps,
        restSec,
        weightKg: weight,
      },
    );
    router.push(`/${exercise.id}/play`);
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href={`/${exercise.id}`} className="text-xs text-muted hover:text-accent-teal mb-4 inline-block">
        ← Back to {exercise.name}
      </Link>
      <h1 className="text-2xl font-bold text-white mb-2">Set up your workout</h1>
      <p className="text-sm text-muted-foreground mb-6">{exercise.name} · {exercise.difficulty}</p>

      <div className="card overflow-hidden mb-6">
        <div className="relative aspect-video bg-surface-2 flex items-center justify-center p-6">
          <HeroIllustration heroId={exercise.images.hero} name={exercise.name} />
        </div>
      </div>

      <div className="card p-6 mb-6 space-y-5">
        {isHold ? (
          <Field label={`Target hold duration (seconds) — minimum ${minHold}s`}>
            <input
              type="number"
              min={minHold}
              max={600}
              value={holdSec}
              onChange={(e) => setHoldSec(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-surface-2 border border-surface-3 text-base focus:outline-none focus:border-accent-teal-border"
            />
          </Field>
        ) : (
          <>
            {exercise.isStrength && (
              <Field label="Added weight (kg) — leave 0 for bodyweight">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded bg-surface-2 border border-surface-3 text-base focus:outline-none focus:border-accent-teal-border"
                />
              </Field>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <Field label="Sets">
                <input
                  type="number" min={1}
                  value={sets}
                  onChange={(e) => setSets(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded bg-surface-2 border border-surface-3 text-base focus:outline-none focus:border-accent-teal-border"
                />
              </Field>
              <Field label="Reps per set">
                <input
                  type="number" min={1}
                  value={reps}
                  onChange={(e) => setReps(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded bg-surface-2 border border-surface-3 text-base focus:outline-none focus:border-accent-teal-border"
                />
              </Field>
              <Field label="Rest (sec)">
                <input
                  type="number" min={0}
                  value={restSec}
                  onChange={(e) => setRestSec(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded bg-surface-2 border border-surface-3 text-base focus:outline-none focus:border-accent-teal-border"
                />
              </Field>
            </div>
          </>
        )}
      </div>

      <div className="mb-6">
        <PrivacyBadge variant="full" />
      </div>

      <div className="card p-6 mb-6">
        <h3 className="text-sm uppercase tracking-wider text-accent-amber mb-3">Safety check</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Please confirm you do not have any of the conditions below. If you do, consult a physiotherapist first.
        </p>
        <div className="space-y-2">
          {exercise.safetyChecks.map((check, i) => (
            <label key={i} className="flex items-start gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={acknowledged[i]}
                onChange={(e) => {
                  const next = [...acknowledged];
                  next[i] = e.target.checked;
                  setAcknowledged(next);
                }}
                className="mt-1 w-5 h-5"
              />
              <span className="text-foreground leading-relaxed">{check}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={start}
        disabled={!valid}
        className="w-full py-4 rounded-lg text-base font-semibold transition bg-accent-teal text-slate-900 hover:bg-accent-teal-hover disabled:bg-surface-2 disabled:text-muted disabled:cursor-not-allowed"
      >
        {valid ? 'Start workout →' : 'Tick all safety boxes to continue'}
      </button>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
