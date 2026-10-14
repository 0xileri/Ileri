import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, get, post } from '../../api';
import { ErrorNotice, Markdown, RuleTree, Spinner, useToast, VideoEmbed } from '../../components/ui';
import type { LessonView } from '../../types';
import { usePlayer } from './Player';

export function LessonPage() {
  const { courseId = '', lessonId = '' } = useParams();
  const { view, refresh } = usePlayer();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['lesson', courseId, lessonId],
    queryFn: () => get<LessonView>(`/api/courses/${courseId}/lessons/${lessonId}`),
  });
  const complete = useMutation({
    mutationFn: () =>
      post<{ courseCompleted: boolean; newlyCompleted: boolean }>(`/api/courses/${courseId}/lessons/${lessonId}/complete`),
    onSuccess: async (result) => {
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['lesson', courseId, lessonId] })]);
      if (result.newlyCompleted) {
        toast('Course complete. Your credential is ready.');
        navigate(`/learn/${courseId}`);
        return;
      }
      const next = query.data?.nextLessonId;
      navigate(next ? `/learn/${courseId}/lessons/${next}` : `/learn/${courseId}`);
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    const err = query.error instanceof ApiError ? query.error : null;
    if (err && (err.code === 'access_suspended' || err.code === 'eligibility_unavailable')) {
      return (
        <div className="card">
          <h2>{err.code === 'access_suspended' ? 'This lesson is locked right now' : "We couldn't confirm your access"}</h2>
          <p>{err.message}</p>
          {err.details?.requirements?.result && <RuleTree result={err.details.requirements.result} />}
          <button className="btn" style={{ marginTop: 12 }} onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      );
    }
    return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />;
  }
  const { lesson, previousLessonId, nextLessonId } = query.data!;
  const moduleTitle = view.modules.find((m) => m.lessons.some((l) => l.id === lesson.id))?.title;

  return (
    <article className="card">
      <p className="small muted" style={{ marginBottom: 4 }}>
        {moduleTitle}
        {lesson.estimatedMinutes ? ` · ${lesson.estimatedMinutes} min` : ''}
        {!lesson.required ? ' · optional' : ''}
      </p>
      <h1>{lesson.title}</h1>
      {lesson.video && <VideoEmbed url={lesson.video.url} mimeType={lesson.video.mimeType} />}
      {!lesson.video && lesson.videoUrl && <VideoEmbed url={lesson.videoUrl} />}
      {lesson.body && <Markdown source={lesson.body} />}
      {lesson.attachments.length > 0 && (
        <div className="card flat tight" style={{ marginTop: 16 }}>
          <h4>Downloads</h4>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {lesson.attachments.map((a) => (
              <li key={a.url}>
                <a href={a.url} target="_blank" rel="noreferrer">
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>Download links expire after a few minutes. Reload the page for fresh ones.</p>
        </div>
      )}
      <hr />
      <div className="row between">
        {previousLessonId ? (
          <Link className="btn ghost" to={`/learn/${courseId}/lessons/${previousLessonId}`}>
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {lesson.completed ? (
          <Link className="btn primary" to={nextLessonId ? `/learn/${courseId}/lessons/${nextLessonId}` : `/learn/${courseId}`}>
            {nextLessonId ? 'Next lesson →' : 'Back to overview'}
          </Link>
        ) : (
          <button className="btn primary" disabled={complete.isPending} onClick={() => complete.mutate()}>
            {complete.isPending ? 'Saving…' : nextLessonId ? 'Mark complete and continue' : 'Mark complete'}
          </button>
        )}
      </div>
      {complete.error && <ErrorNotice error={complete.error} />}
    </article>
  );
}
