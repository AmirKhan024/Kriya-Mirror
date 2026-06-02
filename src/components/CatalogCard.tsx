import Link from 'next/link';
import type { ExerciseConfig } from '@/config/exercises/types';

export function CatalogCard({ exercise }: { exercise: ExerciseConfig }) {
  return (
    <Link href={`/${exercise.id}`} className="block group">
      <div className="card p-6 transition hover:border-accent-teal-border hover:-translate-y-1 hover:shadow-lg hover:shadow-accent-teal-glow">
        <h3 className="text-xl font-semibold text-white mb-1 group-hover:text-accent-teal">
          {exercise.name}
        </h3>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          {exercise.difficulty}
        </p>
        <p className="text-sm text-muted-foreground">
          {exercise.primaryMuscles.slice(0, 2).join(' · ')}
        </p>
      </div>
    </Link>
  );
}
