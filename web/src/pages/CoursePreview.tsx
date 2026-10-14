import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, get, post } from '../api';
import { useAuth } from '../auth';
import {
  brandProps,
  campaignText,
  CommunityLogo,
  ErrorNotice,
  Markdown,
  plural,
  RequirementsPanel,
  RuleTree,
  Spinner,
  StageBadge,
  usePageTitle,
} from '../components/ui';
import type { CoursePreview } from '../types';

export function CoursePreviewPage() {
  const { courseId = '' } = useParams();
  const { user, openSignIn } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['course', courseId], queryFn: () => get<CoursePreview>(`/api/courses/${courseId}`) });
  usePageTitle(query.data?.course.title);
  const enroll = useMutation({
    mutationFn: () => post(`/api/courses/${courseId}/enroll`),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate(`/learn/${courseId}`);
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container page">
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }
  const data = query.data!;
  const { course, community, access } = data;
  const staff = data.viewerRole === 'owner' || data.viewerRole === 'instructor' || data.viewerRole === 'admin';
  const canEnroll = staff || access.state === 'open' || access.state === 'eligible';
  const enrollError = enroll.error instanceof ApiError ? enroll.error : null;

  return (
    <div {...brandProps(community.accentColor)}>
      <section className="banner">
        <div className="container">
          <Link to={`/c/${community.slug}`} className="row" style={{ textDecoration: 'none', color: 'inherit', gap: 8, marginBottom: 12 }}>
            <CommunityLogo name={community.name} logoUrl={community.logoUrl} small />
            <span className="muted">{community.name}</span>
          </Link>
          <h1>{course.title}</h1>
          {course.summary && <p className="muted" style={{ maxWidth: '60ch' }}>{course.summary}</p>}
          <div className="meta">
            <span>{plural(data.lessonCount, 'lesson')}</span>
            {data.estimatedMinutes > 0 && <span>about {Math.round(data.estimatedMinutes / 5) * 5} minutes</span>}
            {data.instructorName && <span>With {data.instructorName}</span>}
            <span>Version {data.version.versionNumber}</span>
            {course.status !== 'published' && <span className="badge warn">{course.status}</span>}
          </div>
        </div>
      </section>

      <div className="container page">
        <div className="split">
          <div className="stack">
            {data.description && <Markdown source={data.description} />}
            {data.outcomes.length > 0 && (
              <section>
                <h2>What you'll be able to do</h2>
                <ul className="checklist">
                  {data.outcomes.map((o) => (
                    <li key={o}>
                      <span className="tick done" aria-hidden="true">✓</span>
                      {o}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h2>Course outline</h2>
              {data.outline.map((m) => (
                <div key={m.id} className="card flat tight" style={{ marginBottom: 10 }}>
                  <h4 style={{ marginBottom: 6 }}>{m.title}</h4>
                  <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
                    {m.lessons.map((l) => (
                      <li key={l.id}>
                        {l.title}
                        <span className="muted">
                          {' '}
                          · {l.kind === 'video' ? 'video' : 'reading'}
                          {l.estimatedMinutes ? `, ${l.estimatedMinutes} min` : ''}
                          {!l.required ? ', optional' : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              {data.quiz && (
                <p className="small muted">
                  Assessment: {data.quiz.questionsPerAttempt} randomised questions, pass mark {data.quiz.passPercent}%, up to{' '}
                  {data.quiz.maxAttempts} attempts.
                </p>
              )}
              {data.assignment && <p className="small muted">Practical assignment: {data.assignment.title}, reviewed against a rubric.</p>}
            </section>
            {data.prerequisitesText && (
              <section>
                <h3>Before you start</h3>
                <p>{data.prerequisitesText}</p>
              </section>
            )}
          </div>

          <aside className="stack">
            <div className="card">
              {data.myCompletion?.status === 'valid' ? (
                <>
                  <span className="badge ok">Completed</span>
                  <p style={{ marginTop: 10 }}>You finished this course.</p>
                  <Link className="btn block" to={`/learn/${course.id}`}>
                    Review course
                  </Link>
                </>
              ) : data.myEnrollment ? (
                <>
                  <StageBadge stage={data.myEnrollment.stage} />
                  <p style={{ marginTop: 10 }}>{data.myEnrollment.progressPercent}% complete</p>
                  <Link className="btn primary block" to={`/learn/${course.id}`}>
                    Continue learning
                  </Link>
                </>
              ) : !user ? (
                <>
                  <p>Sign in to check whether you can take this course.</p>
                  <button className="btn primary block" onClick={openSignIn}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  {course.creditCost > 0 && !staff && (
                    <p className="small">
                      Costs <strong>{course.creditCost} course credits</strong> to enroll.
                    </p>
                  )}
                  <button className="btn primary block" disabled={!canEnroll || enroll.isPending} onClick={() => enroll.mutate()}>
                    {enroll.isPending ? 'Enrolling…' : canEnroll ? 'Enroll' : access.state === 'unknown' ? 'Checking unavailable' : 'Not eligible yet'}
                  </button>
                  {staff && access.state !== 'open' && access.state !== 'eligible' && (
                    <p className="tiny muted" style={{ marginTop: 6 }}>As staff you can enroll without meeting the requirements.</p>
                  )}
                </>
              )}
              {enrollError && (
                <div className="notice bad small" style={{ marginTop: 12 }} role="alert">
                  <strong>{enrollError.message}</strong>
                  {enrollError.details?.requirements?.result && <RuleTree result={enrollError.details.requirements.result} />}
                </div>
              )}
              {access.state === 'unknown' && access.evaluated && (
                <button className="link-button small" style={{ marginTop: 8 }} onClick={() => query.refetch()}>
                  Check again
                </button>
              )}
            </div>

            <div className="card flat">
              <RequirementsPanel requirements={access} title="Who can take this course" />
            </div>

            <div className="card flat">
              <h4>To complete</h4>
              <ul className="checklist small">
                {data.completionRequirements.map((r) => (
                  <li key={r}>
                    <span className="tick" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
              {data.credential && (
                <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
                  You'll receive the <strong>{data.credential.title}</strong> credential, with a public link anyone can verify.
                </p>
              )}
            </div>

            {data.campaigns.length > 0 && (
              <div className="card flat">
                <h4>Rewards</h4>
                {data.campaigns.map((c) => (
                  <p key={c.id} className="small">
                    <strong>{c.name}.</strong> {campaignText(c)}
                  </p>
                ))}
                <p className="tiny muted" style={{ margin: 0 }}>Rewards are funded by {community.name}.</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
