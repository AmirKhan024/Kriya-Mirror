import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getExerciseById } from '@/config/exercises';
import { CATEGORY_LABELS } from '@/config/exercises/types';
import { ModeTabs } from '@/components/ModeTabs';

export default function ExerciseDetailPage({ params }: { params: { exerciseId: string } }) {
  const exercise = getExerciseById(params.exerciseId);
  if (!exercise) notFound();

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <Link href="/" className="text-xs text-muted hover:text-accent-teal mb-4 inline-block">
        ← All exercises
      </Link>
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-accent-teal mb-1">
          {CATEGORY_LABELS[exercise.category]}
        </p>
        <h1 className="text-3xl font-bold text-white">{exercise.name}</h1>
      </header>
      <ModeTabs exercise={exercise} />
    </main>
  );
}
