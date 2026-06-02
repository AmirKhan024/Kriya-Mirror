import Link from 'next/link';
import type { ExerciseConfig } from '@/config/exercises/types';

export function CameraVisionGateway({ exercise }: { exercise: ExerciseConfig }) {
  if (exercise.guidanceModes.cameraVision === 'none') {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-4">📷</div>
        <h3 className="text-xl font-semibold text-white mb-2">Camera Vision unavailable</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          This exercise can&apos;t be tracked by camera vision — the movement is internal,
          underwater, or occluded by equipment. Use Image+Text mode instead.
        </p>
      </div>
    );
  }

  if (!exercise.engineModule) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-4">⏳</div>
        <h3 className="text-xl font-semibold text-white mb-2">Engine coming soon</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The camera-vision engine for this exercise isn&apos;t wired up yet. For now, follow
          the step-by-step guide in Image+Text mode.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-8 text-center">
      <div className="text-5xl mb-4">📷</div>
      <h3 className="text-xl font-semibold text-white mb-2">Camera Vision workout</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
        Set your sets, reps, and weight, then stand in front of your camera. Kriya will count
        reps and call out form corrections live.
      </p>
      <Link
        href={`/${exercise.id}/setup`}
        className="inline-block px-8 py-3 rounded-lg bg-accent-teal text-slate-900 font-semibold hover:bg-accent-teal-hover transition"
      >
        Start Workout →
      </Link>
    </div>
  );
}
