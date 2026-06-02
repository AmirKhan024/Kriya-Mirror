import type { ExerciseConfig } from '@/config/exercises/types';
import { PlankSvg } from './PlankSvg';
import { SquatSvg } from './SquatSvg';
import { PushupSvg } from './PushupSvg';
import { LungeSvg } from './LungeSvg';
import { TandemStandSvg } from './TandemStandSvg';
import { BicepCurlSvg } from './BicepCurlSvg';
import { SingleLegStandSvg } from './SingleLegStandSvg';
import { ChairPoseSvg } from './ChairPoseSvg';
import { LateralRaiseSvg } from './LateralRaiseSvg';
import { TreePoseSvg } from './TreePoseSvg';
import { WarriorTwoSvg } from './WarriorTwoSvg';
import { MountainPoseSvg } from './MountainPoseSvg';
import { CalfRaiseSvg } from './CalfRaiseSvg';
import { JumpingJacksSvg } from './JumpingJacksSvg';
import { HighKneesSvg } from './HighKneesSvg';
import { FrontRaiseSvg } from './FrontRaiseSvg';
import { ArmCirclesSvg } from './ArmCirclesSvg';
import { HeroIllustration } from './HeroIllustration';

export function ImageTextMode({ exercise }: { exercise: ExerciseConfig }) {
  return (
    <div className="space-y-8">
      <div className="card overflow-hidden">
        <div className="relative aspect-video bg-surface-2 flex items-center justify-center p-6">
          <HeroIllustration heroId={exercise.images.hero} name={exercise.name} />
        </div>
      </div>

      {exercise.id === 'plank' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><PlankSvg variant="hero" label="Correct form" /></div>
            <div className="card p-4"><PlankSvg variant="sag" label="Hips sagging (wrong)" /></div>
            <div className="card p-4"><PlankSvg variant="pike" label="Hips piked (wrong)" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'squat' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><SquatSvg variant="stand" label="Standing tall" /></div>
            <div className="card p-4"><SquatSvg variant="descend" label="Mid-descent" /></div>
            <div className="card p-4"><SquatSvg variant="hero" label="Parallel depth" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'pushup' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><PushupSvg variant="top" label="Top — arms straight" /></div>
            <div className="card p-4"><PushupSvg variant="mid" label="Mid — elbows ~45°" /></div>
            <div className="card p-4"><PushupSvg variant="bottom" label="Bottom — elbows ~90°" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'lunge' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><LungeSvg variant="stand" label="Standing tall" /></div>
            <div className="card p-4"><LungeSvg variant="mid" label="Mid — knee bending" /></div>
            <div className="card p-4"><LungeSvg variant="hero" label="Bottom — front thigh parallel" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'tandem-stand' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><TandemStandSvg variant="hero" label="Tandem stance — heel to toe" /></div>
            <div className="card p-4"><TandemStandSvg variant="shifted" label="Mid sway (wrong)" /></div>
            <div className="card p-4"><TandemStandSvg variant="stand" label="Correct form" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'bicep-curl' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><BicepCurlSvg variant="extended" label="Bottom — arms extended" /></div>
            <div className="card p-4"><BicepCurlSvg variant="mid" label="Mid — forearms horizontal" /></div>
            <div className="card p-4"><BicepCurlSvg variant="top" label="Top — squeeze the biceps" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'single-leg-stand' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><SingleLegStandSvg variant="standing" label="Correct — hips level" /></div>
            <div className="card p-4"><SingleLegStandSvg variant="tilted" label="Wrong — hip dropped" /></div>
            <div className="card p-4"><SingleLegStandSvg variant="hero" label="Hold steady — eyes ahead" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'chair-pose' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><ChairPoseSvg variant="hero" label="Correct — knees ~90°, chest tall" /></div>
            <div className="card p-4"><ChairPoseSvg variant="knees-straight" label="Wrong — knees straightening" /></div>
            <div className="card p-4"><ChairPoseSvg variant="forward-lean" label="Wrong — leaning forward" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'lateral-raise' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><LateralRaiseSvg variant="down" label="Bottom — arms at sides" /></div>
            <div className="card p-4"><LateralRaiseSvg variant="mid" label="Mid — arms ~45°" /></div>
            <div className="card p-4"><LateralRaiseSvg variant="top" label="Top — arms at shoulder height" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'tree-pose' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4"><TreePoseSvg variant="hero" label="Correct — foot pressed onto leg" /></div>
            <div className="card p-4"><TreePoseSvg variant="foot-off" label="Wrong — foot drifted off" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'warrior-2' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><WarriorTwoSvg variant="hero" label="Correct — bent knee at 90°, other leg straight" /></div>
            <div className="card p-4"><WarriorTwoSvg variant="knee-up" label="Wrong — bent knee too straight" /></div>
            <div className="card p-4"><WarriorTwoSvg variant="lean" label="Wrong — torso leaning forward" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'mountain-pose' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4"><MountainPoseSvg variant="hero" label="Correct — shoulders + hips level, spine vertical" /></div>
            <div className="card p-4"><MountainPoseSvg variant="tilted" label="Wrong — posture misaligned" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'calf-raise' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><CalfRaiseSvg variant="down" label="Bottom — heels flat" /></div>
            <div className="card p-4"><CalfRaiseSvg variant="mid" label="Mid — heels rising" /></div>
            <div className="card p-4"><CalfRaiseSvg variant="top" label="Top — on your toes" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'jumping-jacks' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4"><JumpingJacksSvg variant="closed" label="Start — feet together, arms at sides" /></div>
            <div className="card p-4"><JumpingJacksSvg variant="open" label="Out — arms overhead, feet wide" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'high-knees' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4"><HighKneesSvg variant="left-up" label="Left knee up — drive to hip height" /></div>
            <div className="card p-4"><HighKneesSvg variant="right-up" label="Right knee up — alternate continuously" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'front-raise' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4"><FrontRaiseSvg variant="down" label="Bottom — arms at sides" /></div>
            <div className="card p-4"><FrontRaiseSvg variant="mid" label="Mid — arms at ~45°" /></div>
            <div className="card p-4"><FrontRaiseSvg variant="top" label="Top — arms parallel to floor" /></div>
          </div>
        </Section>
      )}

      {exercise.id === 'arm-circles' && (
        <Section title="Form reference">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4"><ArmCirclesSvg variant="forward" label="Forward circles — sweep up + over" /></div>
            <div className="card p-4"><ArmCirclesSvg variant="backward" label="Backward circles — reverse direction" /></div>
          </div>
        </Section>
      )}

      <Section title="Step-by-step">
        <ol className="space-y-3 list-decimal list-inside text-foreground">
          {exercise.instructions.map((step, i) => (
            <li key={i} className="leading-relaxed">{step}</li>
          ))}
        </ol>
      </Section>

      <Section title="Common mistakes to avoid">
        <div className="space-y-2">
          {exercise.commonErrors.map((err, i) => (
            <div key={i} className="card p-4">
              <div className="text-accent-danger text-sm">⚠ {err.error}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Breathing">
        <p className="text-sm text-foreground">{exercise.breathing}</p>
      </Section>

      <div className="grid sm:grid-cols-2 gap-4">
        <Section title="Easier modifications">
          <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
            {exercise.modifications.easier.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </Section>
        <Section title="Harder progressions">
          <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
            {exercise.modifications.harder.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </Section>
      </div>

      <Section title="At a glance">
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">
          <Detail label="Equipment" value={exercise.equipment.join(', ')} />
          <Detail label="Works your" value={exercise.primaryMuscles.join(', ')} />
          <Detail label="Also engages" value={exercise.secondaryMuscles.join(', ')} />
          <Detail label="Difficulty" value={exercise.difficulty} />
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm uppercase tracking-wider text-accent-teal mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
