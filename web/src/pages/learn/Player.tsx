import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { ApiError, get } from '../../api';
import { brandProps, ErrorNotice, ProgressBar, RuleTree, Spinner, StageBadge, usePageTitle } from '../../components/ui';
import type { LearnView } from '../../types';

export interface PlayerContext {
  view: LearnView;
  refresh: () => Promise<unknown>;
}

export function usePlayer() {
  return useOutletContext<PlayerContext>();
}

export function Player() {
  const { courseId = '' } = useParams();
  const query = useQuery({ queryKey: ['learn', courseId], queryFn: () => get<LearnView>(`/api/courses/${courseId}/learn`) });
  usePageTitle(query.data?.course.title);

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    const notEnrolled = query.error instanceof ApiError && query.error.code === 'not_enrolled';
    return (
      <div className="container narrow page">
        {notEnrolled ? (
          <div className="card">
            <h1>You're not enrolled yet</h1>
            <p className="muted">Check the course requirements and enroll to start learning.</p>
            <Link className="btn primary" to={`/courses/${courseId}`}>
              View course
            </Link>
          </div>
        ) : (
          <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
        )}
      </div>
    );
  }
  const view = query.data!;
  const outline = <Outline view={view} />;
  return (
    <div className="container page" {...brandProps(view.community.accentColor)}>
      <div className="player">
        <aside className="player-nav">
          <div className="card tight">
            <Link to={`/c/${view.community.slug}`} className="small muted" style={{ textDecoration: 'none' }}>
              {view.community.name}
            </Link>
            <h3 style={{ margin: '4px 0 10px' }}>
              <Link to={`/learn/${view.course.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {view.course.title}
              </Link>
            </h3>
            <div className="row between small" style={{ marginBottom: 6 }}>
              <StageBadge stage={view.stage} />
              <span className="muted">{view.progress.percent}%</span>
            </div>
            <ProgressBar value={view.progress.percent} label="Course progress" />
            <div className="desktop-only">{outline}</div>
            <details className="mobile-only">
              <summary className="small" style={{ marginTop: 12, cursor: 'pointer', fontWeight: 600 }}>
                Course outline
              </summary>
              {outline}
            </details>
          </div>
        </aside>
        <section>
          {view.access.state !== 'granted' && (
            <div className={`notice ${view.access.state === 'unavailable' ? 'warn' : 'bad'}`} style={{ marginBottom: 18 }} role="status">
              <strong>{view.access.state === 'unavailable' ? "We couldn't check your access" : 'Access paused'}</strong>
              <p style={{ margin: '4px 0 8px' }}>{view.access.message}</p>
              {view.access.requirements?.result && <RuleTree result={view.access.requirements.result} />}
              <button className="btn small" style={{ marginTop: 10 }} onClick={() => query.refetch()}>
                Check again
              </button>
            </div>
          )}
          {!view.version.isCurrent && (
            <p className="notice info small" style={{ marginBottom: 18 }}>
              You're on version {view.version.versionNumber} of this course, the one you enrolled in. Newer versions don't change your
              requirements or progress.
            </p>
          )}
          <Outlet context={{ view, refresh: () => query.refetch() } satisfies PlayerContext} />
        </section>
      </div>
    </div>
  );
}

function Outline({ view }: { view: LearnView }) {
  const base = `/learn/${view.course.id}`;
  return (
    <nav aria-label="Course outline">
      <ul className="outline">
        <li>
          <NavLink end to={base}>
            <span className={`tick ${view.stage === 'completed' ? 'done' : ''}`} aria-hidden="true">
              {view.stage === 'completed' ? '✓' : ''}
            </span>
            Overview
          </NavLink>
        </li>
        {view.modules.map((m) => (
          <li key={m.id}>
            <div className="module-title">{m.title}</div>
            <ul className="outline">
              {m.lessons.map((l) => (
                <li key={l.id}>
                  <NavLink to={`${base}/lessons/${l.id}`}>
                    <span className={`tick ${l.completed ? 'done' : ''}`} aria-hidden="true">
                      {l.completed ? '✓' : ''}
                    </span>
                    <span>
                      {l.title}
                      <span className="sr-only">{l.completed ? ' (completed)' : ''}</span>
                      {!l.required && <span className="tiny muted"> · optional</span>}
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {(view.quiz || view.assignment) && <li className="module-title">Prove what you learned</li>}
        {view.quiz && (
          <li>
            <NavLink to={`${base}/quiz`}>
              <span className={`tick ${view.quiz.passed ? 'done' : ''}`} aria-hidden="true">
                {view.quiz.passed ? '✓' : ''}
              </span>
              {view.quiz.title}
            </NavLink>
          </li>
        )}
        {view.assignment && (
          <li>
            <NavLink to={`${base}/assignment`}>
              <span className={`tick ${view.assignment.submissions[0]?.status === 'approved' ? 'done' : ''}`} aria-hidden="true">
                {view.assignment.submissions[0]?.status === 'approved' ? '✓' : ''}
              </span>
              {view.assignment.title}
            </NavLink>
          </li>
        )}
      </ul>
    </nav>
  );
}
