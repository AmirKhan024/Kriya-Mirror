import { ALL_CATEGORIES, type ExerciseCategory } from '@/config/exercises/types';
import { getExercisesByCategory } from '@/config/exercises';
import { CategorySection } from '@/components/CategorySection';
import { PrivacyBadge } from '@/components/PrivacyBadge';

export default function HomePage() {
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-widest text-accent-teal mb-2">Kriya Mirror</p>
        <h1 className="text-4xl font-bold text-white mb-3">Camera-vision fitness coaching.</h1>
        <p className="text-muted-foreground text-balance max-w-2xl">
          Pick an exercise. Your camera watches your form, counts your reps, and tells you what to fix — live.
        </p>
        <div className="mt-5">
          <PrivacyBadge />
        </div>
      </header>

      {ALL_CATEGORIES.map((cat: ExerciseCategory) => (
        <CategorySection key={cat} category={cat} exercises={getExercisesByCategory(cat)} />
      ))}
    </main>
  );
}
