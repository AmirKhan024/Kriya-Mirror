import type { ExerciseCategory, ExerciseConfig } from '@/config/exercises/types';
import { CATEGORY_LABELS } from '@/config/exercises/types';
import { CatalogCard } from './CatalogCard';

interface Props {
  category: ExerciseCategory;
  exercises: ExerciseConfig[];
}

export function CategorySection({ category, exercises }: Props) {
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-semibold text-white">{CATEGORY_LABELS[category]}</h2>
        <span className="text-xs text-muted">
          {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}
        </span>
      </div>
      {exercises.length === 0 ? (
        <div className="card p-6 text-center text-sm text-muted">
          Coming soon — no exercises in this category yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {exercises.map((ex) => (
            <CatalogCard key={ex.id} exercise={ex} />
          ))}
        </div>
      )}
    </section>
  );
}
