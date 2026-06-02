'use client';
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWorkout, type WarningType } from '@/store/workout';
import { getHoldCompletionScore, getFinalMqs } from '@/modules/plank/scoring';

const WARNING_LABEL: Record<WarningType, string> = {
  'heel-lift': 'Heel lift',
  valgus: 'Knee cave (valgus)',
  'trunk-forward': 'Trunk forward',
  'feet-narrow': 'Feet narrow',
  'not-facing': 'Not facing camera',
  'too-close': 'Too close to camera',
  'too-far': 'Too far from camera',
  'not-moving': 'Idle / no movement',
  'malformed-rep': 'Rep rejected (form)',
  'hip-sag': 'Hip sag',
  'hip-pike': 'Hip pike',
  'spine-misaligned': 'Spine misaligned',
  'neck-droop': 'Neck droop',
  'hold-broken': 'Hold broken',
  'elbow-flare': 'Elbow flare',
  'incomplete-pushup': 'Shallow push-up',
  'knee-past-toe': 'Knee past toe',
  'incomplete-lunge': 'Shallow lunge',
  swaying: 'Sway / instability',
  'feet-separated': 'Feet drifted out of stance',
  'torso-swing': 'Torso swing / momentum',
  'elbow-drift': 'Elbows drifted forward',
  'incomplete-curl': 'Shallow curl',
  'hip-tilted': 'Hip dropped (lifted side)',
  'position-lost': 'Stepped out of frame',
  'hands-off-hips': 'Hands left hips',
  'foot-dropped': 'Foot dropped',
  'knee-too-straight': 'Knees straightening up',
  'torso-too-forward': 'Torso leaning forward',
  'knee-too-deep': 'Squatted too deep',
  'incomplete-raise': 'Shallow raise (below shoulder height)',
  'arm-asymmetry': 'Arms uneven (one lagged)',
  'foot-off-leg': 'Foot drifted off the standing leg',
  'front-knee-not-bent-enough': 'Front knee too straight',
  'front-knee-bent-too-much': 'Front knee past 90°',
  'back-knee-bent': 'Back leg bending',
  'posture-not-aligned': 'Posture misaligned',
  'low-heel-rise': 'Shallow calf raise',
  'incomplete-jack': 'Half-jack (arms or feet)',
  'low-knee-lift': 'Shallow knee lift',
  'knees-caving': 'Knees caving inward',
  'arms-dropped': 'Elbows dropped (cactus broken)',
  'leg-not-straight': 'Knee bending (should stay straight)',
  'top-arm-not-vertical': 'Top arm not vertical',
  'bottom-arm-not-down': 'Bottom arm not reaching front foot',
  'arms-too-high': 'Arms went overhead (shoulder press)',
  'arms-forward-not-side': 'Arms went forward (front raise)',
  'arms-out-not-front': 'Arms went lateral (lateral raise)',
  'heel-dropped': 'Heels dropped mid-hold (timer paused)',
  'arms-not-overhead': 'Arms dropped from overhead',
  'low-leg-raise': 'Shallow leg raise',
  'incomplete-bend': 'Shallow side bend',
  'incomplete-stand': 'Did not stand fully',
  'torso-not-level': 'Torso too upright (not level)',
  'back-leg-low': 'Back leg dropped too low',
  'legs-dropped': 'Legs dropped (boat)',
  'chest-dropped': 'Chest collapsed (boat)',
  'not-folded-enough': 'Came up out of the fold',
  'chest-not-lifted': 'Chest dropped (not lifted)',
  'shallow-spine-rom': 'Shallow spine range',
  'arms-not-straight': 'Arms bending (should stay straight)',
};

export default function ReportPage({ params: _params }: { params: { exerciseId: string } }) {
  const router = useRouter();
  const exercise = useWorkout((s) => s.exercise);
  const setup = useWorkout((s) => s.setup);
  const sets = useWorkout((s) => s.sets);
  const holdRecord = useWorkout((s) => s.holdRecord);
  const startedAt = useWorkout((s) => s.workoutStartedAt);
  const endedAt = useWorkout((s) => s.workoutEndedAt);
  const reset = useWorkout((s) => s.reset);
  const manuallyEnded = useWorkout((s) => s.manuallyEnded);
  const playAgain = useWorkout((s) => s.playAgain);

  const isHold = exercise?.exerciseType === 'hold-based';

  useEffect(() => {
    if (!exercise || !setup) router.replace('/');
    else if (!isHold && sets.length === 0) router.replace('/');
    else if (isHold && !holdRecord) router.replace('/');
  }, [exercise, setup, sets.length, holdRecord, isHold, router]);

  // ─── Rep-based summary ────────────────────────────────────
  const repTotals = useMemo(() => {
    const totalReps = sets.reduce((s, st) => s + st.reps.length, 0);
    const totalPlanned = sets.reduce((s, st) => s + st.plannedReps, 0);
    const avgMqs = totalReps === 0 ? 0
      : sets.reduce((s, st) => s + st.reps.reduce((r, x) => r + x.mqs, 0), 0) / totalReps;
    const warningTotals = newWarningTotals();
    for (const st of sets) {
      for (const [k, v] of Object.entries(st.warningCounts) as [WarningType, number][]) {
        warningTotals[k] = (warningTotals[k] ?? 0) + v;
      }
    }
    const dur = startedAt && endedAt ? Math.round((endedAt - startedAt) / 1000) : 0;
    return { totalReps, totalPlanned, avgMqs, warningTotals, durSec: dur };
  }, [sets, startedAt, endedAt]);

  // ─── Hold-based summary ───────────────────────────────────
  const holdSummary = useMemo(() => {
    if (!holdRecord) return null;
    const completion = getHoldCompletionScore(holdRecord.actualDurationSec, holdRecord.targetDurationSec);
    const final = getFinalMqs(completion, holdRecord.averageMqs);
    return { completion, final };
  }, [holdRecord]);

  if (!exercise || !setup) return null;

  if (isHold && holdRecord && holdSummary) {
    const maxWarning = Math.max(1, ...Object.values(holdRecord.warningCounts));
    const accentColor = holdSummary.final >= 75 ? 'text-accent-teal'
      : holdSummary.final >= 50 ? 'text-accent-amber' : 'text-accent-danger';
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-xs uppercase tracking-widest text-accent-teal mb-1">{exercise.name}</p>
        <h1 className="text-3xl font-bold text-white mb-4">Workout report</h1>
        {manuallyEnded && (
          <div className="bg-overlay-amber rounded-xl px-5 py-3 mb-6 border border-accent-amber-border">
            <div className="text-warning text-white font-bold">
              ⚠ Session ended manually
            </div>
            <p className="text-sm text-amber-100 mt-1">
              You tapped Complete before finishing the full workout. Stats below reflect only what you did.
            </p>
          </div>
        )}

        <div className="card p-6 sm:p-8 mb-6 text-center">
          <div className="text-xs uppercase tracking-widest text-muted mb-2">Workout accuracy</div>
          <div className={`text-5xl sm:text-7xl font-bold mb-2 ${accentColor}`}>{holdSummary.final}</div>
          <div className="text-sm text-muted-foreground">
            longest hold {holdRecord.longestUnfrozenSec}s of {holdRecord.targetDurationSec}s target
            {holdRecord.broken && ' · hold broken'}
          </div>
        </div>

        {/* 2026-05-25 round 10: Longest hold is the clinically-meaningful number
            for balance — primary stat. Total valid time becomes a smaller aside. */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
          <Stat label="Longest hold" value={`${holdRecord.longestUnfrozenSec}s`} />
          <Stat label="Avg form score" value={Math.round(holdRecord.averageMqs).toString()} />
          <Stat label="Target met" value={`${holdSummary.completion}%`} />
        </div>
        <div className="text-xs text-muted-foreground text-center mb-6">
          Total valid hold time: <span className="text-foreground font-medium">{holdRecord.actualDurationSec}s</span>
          {' '}of {holdRecord.targetDurationSec}s target
          {holdRecord.broken && ' · hold broken'}
        </div>

        <section className="mb-6">
          <h2 className="text-sm uppercase tracking-wider text-accent-teal mb-3">Form over time</h2>
          <div className="card p-5">
            <FormTimeChart samples={holdRecord.formTimeSeries} />
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-accent-teal mb-3">Posture issues this hold</h2>
          <div className="card p-5 space-y-3">
            {(Object.entries(holdRecord.warningCounts) as [WarningType, number][])
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
              <div key={type}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-foreground">{WARNING_LABEL[type]}</span>
                </div>
                <div className="h-1.5 bg-surface-2 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent-amber"
                    style={{ width: `${(count / maxWarning) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {Object.values(holdRecord.warningCounts).every((v) => v === 0) && (
              <div className="text-sm text-muted-foreground text-center py-2">
                Perfect hold — no form issues detected.
              </div>
            )}
          </div>
        </section>

        <GlossaryHoldBased />
        <ReportActions exerciseId={exercise.id} reset={reset} playAgain={playAgain} />
      </main>
    );
  }

  // ─── Rep-based render ─────────────────────────────────────
  const maxWarning = Math.max(1, ...Object.values(repTotals.warningTotals));
  const accentColor = repTotals.avgMqs >= 75 ? 'text-accent-teal'
    : repTotals.avgMqs >= 50 ? 'text-accent-amber' : 'text-accent-danger';

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <p className="text-xs uppercase tracking-widest text-accent-teal mb-1">{exercise.name}</p>
      <h1 className="text-3xl font-bold text-white mb-6">Workout report</h1>

      <div className="card p-6 sm:p-8 mb-6 text-center">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">Workout accuracy</div>
        <div className={`text-5xl sm:text-7xl font-bold mb-2 ${accentColor}`}>{Math.round(repTotals.avgMqs)}</div>
        <div className="text-sm text-muted-foreground">average score across {repTotals.totalReps} reps</div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
        <Stat label="Reps done" value={`${repTotals.totalReps}/${repTotals.totalPlanned}`} />
        <Stat label="Total time" value={`${Math.floor(repTotals.durSec / 60)}m ${repTotals.durSec % 60}s`} />
        <Stat label="Added weight" value={setup.weightKg && setup.weightKg > 0 ? `${setup.weightKg} kg` : 'Bodyweight'} />
      </div>

      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-wider text-accent-teal mb-3">Per-set breakdown</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-surface-2">
                <th className="px-4 py-2">Set</th>
                <th className="px-4 py-2">Reps</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Top issue</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => {
                const topWarning = (Object.entries(s.warningCounts) as [WarningType, number][])
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])[0];
                return (
                  <tr key={s.setNumber} className="border-b border-surface-2 last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{s.setNumber}</td>
                    <td className="px-4 py-3 text-foreground">{s.reps.length}/{s.plannedReps}</td>
                    <td className="px-4 py-3 text-accent-teal font-semibold">{Math.round(s.mqs)}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {topWarning ? WARNING_LABEL[topWarning[0]] : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wider text-accent-teal mb-3">Posture issues this workout</h2>
        <div className="card p-5 space-y-3">
          {(Object.entries(repTotals.warningTotals) as [WarningType, number][])
            .filter(([, v]) => v > 0)
            .map(([type, count]) => (
            <div key={type}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-foreground">{WARNING_LABEL[type]}</span>
              </div>
              <div className="h-1.5 bg-surface-2 rounded overflow-hidden">
                <div
                  className="h-full bg-accent-amber"
                  style={{ width: `${(count / maxWarning) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <GlossaryRepBased />
      <ReportActions exerciseId={exercise.id} reset={reset} playAgain={playAgain} />
    </main>
  );
}

function ReportActions({
  exerciseId,
  reset,
  playAgain,
}: {
  exerciseId: string;
  reset: () => void;
  playAgain: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* 2026-05-25 round 2 issue 4: dropped "(same setup)" — the secondary
          button below makes the distinction obvious. */}
      <Link
        href={`/${exerciseId}/play`}
        onClick={() => playAgain()}
        className="block w-full py-4 rounded-lg bg-accent-teal text-slate-900 font-bold text-warning text-center hover:bg-accent-teal-hover active:scale-95 transition"
      >
        ▶ Play again
      </Link>
      <div className="flex gap-3">
        <Link
          href="/"
          onClick={() => reset()}
          className="flex-1 py-3 rounded-lg border border-surface-3 text-foreground font-semibold text-center hover:border-accent-teal-border"
        >
          All exercises
        </Link>
      </div>
    </div>
  );
}

/**
 * 2026-05-25 round 2 issue 2: plain-English explanations for the technical
 * terms shown on the report. Collapsed by default so it doesn't clutter the
 * page for returning users. One-liner per term.
 *
 * 2026-05-25 round 3: split into rep-based vs hold-based variants — the hold
 * report shows different fields (Hold duration, Target met) than the rep
 * report (per-set Score, Depth), so the glossary must match.
 */
function GlossaryRepBased() {
  return (
    <details className="card p-5 mb-6 text-sm cursor-pointer">
      <summary className="text-accent-teal font-semibold uppercase tracking-wider text-xs select-none">
        What do these scores mean?
      </summary>
      <dl className="mt-4 space-y-3 text-foreground">
        <div>
          <dt className="font-semibold text-white">Workout accuracy</dt>
          <dd className="text-muted-foreground">
            Your overall score for the workout, 0–100. Average of every rep&apos;s score.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Score (per rep / per set)</dt>
          <dd className="text-muted-foreground">
            How good that rep / set was, 0–100. Combines depth, smoothness, and form.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Depth</dt>
          <dd className="text-muted-foreground">
            How far your knees bent at the bottom of the rep, in degrees. 90° is roughly parallel; deeper is more.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Form</dt>
          <dd className="text-muted-foreground">
            How often your heels, knees, and back stayed in good positions during the rep.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Top issue (per-set table)</dt>
          <dd className="text-muted-foreground">
            The most common form mistake during that set — what to focus on next time.
          </dd>
        </div>
      </dl>
    </details>
  );
}

function GlossaryHoldBased() {
  return (
    <details className="card p-5 mb-6 text-sm cursor-pointer">
      <summary className="text-accent-teal font-semibold uppercase tracking-wider text-xs select-none">
        What do these scores mean?
      </summary>
      <dl className="mt-4 space-y-3 text-foreground">
        <div>
          <dt className="font-semibold text-white">Workout accuracy</dt>
          <dd className="text-muted-foreground">
            Your overall score, 0–100. Combines how close you got to your target hold time and how well you held the position.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Hold duration</dt>
          <dd className="text-muted-foreground">
            How many seconds you maintained a proper hold. Time spent with broken form (e.g., hips sagging) doesn&apos;t count.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Avg form score</dt>
          <dd className="text-muted-foreground">
            How clean your form was during the hold, 0–100. Covers hip, spine, and shoulder alignment.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Target met</dt>
          <dd className="text-muted-foreground">
            What fraction of your target hold time you reached.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Top issue</dt>
          <dd className="text-muted-foreground">
            The form mistake that fired most often — what to focus on next time.
          </dd>
        </div>
      </dl>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-2 sm:p-4 text-center">
      <div className="text-[11px] sm:text-[10px] uppercase tracking-wider text-muted mb-1 leading-tight">{label}</div>
      <div className="text-base sm:text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function FormTimeChart({ samples }: { samples: Array<{ t: number; mqs: number }> }) {
  if (samples.length < 2) {
    return <div className="text-sm text-muted-foreground text-center py-6">Not enough data for chart.</div>;
  }
  // 2026-05-25 round 13: guard against all-samples-at-t=0 (happens when the
  // hold accumulator never advanced past 0, e.g. degenerate baseline → form
  // permanently broken → ticks fire with secondsElapsed=0). Without this,
  // every plotX = NaN and the SVG throws hundreds of errors in dev.
  const maxT = Math.max(...samples.map((s) => s.t));
  if (maxT <= 0) {
    return <div className="text-sm text-muted-foreground text-center py-6">Hold never advanced — form broke instantly.</div>;
  }
  // 2026-05-25 round 4: axis labels — left pad for y-ticks, bottom pad for x-ticks.
  const W = 600, H = 160;
  const PAD_L = 32, PAD_R = 10, PAD_T = 10, PAD_B = 28;
  const plotX = (t: number) => PAD_L + (t / maxT) * (W - PAD_L - PAD_R);
  const plotY = (mqs: number) => PAD_T + (1 - mqs / 100) * (H - PAD_T - PAD_B);

  const path = samples.map((s, i) => {
    return `${i === 0 ? 'M' : 'L'} ${plotX(s.t).toFixed(1)} ${plotY(s.mqs).toFixed(1)}`;
  }).join(' ');

  // X-axis ticks: 0, 25%, 50%, 75%, 100% of maxT — rounded to whole seconds.
  const xTickCount = 5;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => Math.round((maxT * i) / (xTickCount - 1)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Form score over time">
      {/* Reference lines at 25/50/75/100 */}
      {[0, 25, 50, 75, 100].map((pct) => (
        <line
          key={pct}
          x1={PAD_L} y1={plotY(pct)}
          x2={W - PAD_R} y2={plotY(pct)}
          stroke="#243049" strokeDasharray={pct === 0 || pct === 100 ? undefined : '3 3'} strokeWidth="1"
        />
      ))}
      {/* Y-axis tick labels */}
      {[0, 25, 50, 75, 100].map((pct) => (
        <text
          key={`yt-${pct}`}
          x={PAD_L - 6} y={plotY(pct) + 3}
          fontSize="9" fill="#94a3b8" textAnchor="end"
        >
          {pct}
        </text>
      ))}
      {/* Y-axis title */}
      <text
        x={10} y={H / 2}
        fontSize="10" fill="#94a3b8" textAnchor="middle"
        transform={`rotate(-90 10 ${H / 2})`}
      >
        Form score
      </text>
      {/* X-axis tick labels */}
      {xTicks.map((t, i) => (
        <text
          key={`xt-${i}`}
          x={plotX(t)} y={H - PAD_B + 12}
          fontSize="9" fill="#94a3b8" textAnchor="middle"
        >
          {t}s
        </text>
      ))}
      {/* X-axis title */}
      <text
        x={PAD_L + (W - PAD_L - PAD_R) / 2} y={H - 4}
        fontSize="10" fill="#94a3b8" textAnchor="middle"
      >
        Time (seconds)
      </text>
      {/* Form-score line */}
      <path d={path} fill="none" stroke="#00E5CC" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function newWarningTotals(): Record<WarningType, number> {
  return {
    'heel-lift': 0, valgus: 0, 'trunk-forward': 0, 'feet-narrow': 0,
    'not-facing': 0, 'too-close': 0, 'too-far': 0,
    'not-moving': 0, 'malformed-rep': 0,
    'hip-sag': 0, 'hip-pike': 0, 'spine-misaligned': 0, 'neck-droop': 0, 'hold-broken': 0,
    'elbow-flare': 0, 'incomplete-pushup': 0,
    'knee-past-toe': 0, 'incomplete-lunge': 0,
    swaying: 0, 'feet-separated': 0,
    'torso-swing': 0, 'elbow-drift': 0, 'incomplete-curl': 0,
    'hip-tilted': 0,
    'position-lost': 0,
    'hands-off-hips': 0,
    'foot-dropped': 0,
    'knee-too-straight': 0,
    'torso-too-forward': 0,
    'knee-too-deep': 0,
    'incomplete-raise': 0,
    'arm-asymmetry': 0,
    'foot-off-leg': 0,
    'front-knee-not-bent-enough': 0,
    'front-knee-bent-too-much': 0,
    'back-knee-bent': 0,
    'posture-not-aligned': 0,
    'low-heel-rise': 0,
    'incomplete-jack': 0,
    'low-knee-lift': 0,
    'knees-caving': 0,
    'arms-dropped': 0,
    'leg-not-straight': 0,
    'top-arm-not-vertical': 0,
    'bottom-arm-not-down': 0,
    'arms-too-high': 0,
    'arms-forward-not-side': 0,
    'arms-out-not-front': 0,
    'heel-dropped': 0,
    'arms-not-overhead': 0,
    'low-leg-raise': 0,
    'incomplete-bend': 0,
    'incomplete-stand': 0,
    'torso-not-level': 0,
    'back-leg-low': 0,
    'legs-dropped': 0,
    'chest-dropped': 0,
    'not-folded-enough': 0,
    'chest-not-lifted': 0,
    'shallow-spine-rom': 0,
    'arms-not-straight': 0,
  };
}
