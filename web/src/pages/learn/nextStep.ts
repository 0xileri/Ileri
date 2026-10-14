import type { LearnView } from '../../types';

/** The single most useful thing for the learner to do next. */
export function nextStep(view: LearnView): { label: string; path: string } | null {
  if (view.completion) return null;
  const lessons = view.modules.flatMap((m) => m.lessons);
  const resume = lessons.find((l) => l.id === view.lastLessonId && !l.completed);
  const firstOpen = resume ?? lessons.find((l) => l.required && !l.completed);
  if (firstOpen) {
    const started = lessons.some((l) => l.completed);
    return { label: `${started ? 'Continue' : 'Start'}: ${firstOpen.title}`, path: `/lessons/${firstOpen.id}` };
  }
  if (view.quiz?.required && !view.quiz.passed && view.quiz.attemptsUsed < view.quiz.maxAttempts) {
    return { label: view.quiz.openAttemptId ? 'Resume the quiz' : 'Take the quiz', path: '/quiz' };
  }
  const latest = view.assignment?.submissions[0];
  if (view.assignment?.required) {
    if (!latest) return { label: 'Submit your assignment', path: '/assignment' };
    if (latest.status === 'revision_required') return { label: 'Revise your assignment', path: '/assignment' };
    return { label: 'See your submission', path: '/assignment' };
  }
  return null;
}
