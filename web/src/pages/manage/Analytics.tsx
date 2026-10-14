import { useQuery } from '@tanstack/react-query';
import { get } from '../../api';
import { ErrorNotice, Spinner, Stat } from '../../components/ui';
import type { Analytics } from './analyticsTypes';
import { useManage } from './ManageRoutes';

export function AnalyticsPage() {
  const { community } = useManage();
  const query = useQuery({ queryKey: ['analytics', community.id], queryFn: () => get<Analytics>(`/api/communities/${community.id}/analytics`) });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />;
  const a = query.data!;
  const max = Math.max(1, ...a.weekly.flatMap((w) => [w.enrollments, w.completions]));
  return (
    <div className="stack">
      <section>
        <h2>Learning outcomes</h2>
        <p className="muted small">Verified completions are the headline number: they need server-graded assessments and, where required, reviewer approval.</p>
        <div className="stats">
          <Stat value={a.summary.completions} label="Verified completions" />
          <Stat value={`${a.summary.completionRate}%`} label="Enrollments that completed" />
          <Stat value={`${a.summary.memberEnrollmentRate}%`} label="Members who enrolled" />
          <Stat value={a.summary.returningLearners} label="Learners with 2+ courses" />
          <Stat value={a.summary.enrollments30d} label="Enrollments, last 30 days" />
          <Stat value={a.summary.completions30d} label="Completions, last 30 days" />
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Last 8 weeks</h3>
          <div className="legend">
            <span className="a">Enrollments</span>
            <span className="b">Completions</span>
          </div>
        </div>
        <div className="bars" role="img" aria-label="Weekly enrollments and completions">
          {a.weekly.map((w) => (
            <div key={w.week} className="bar-group" title={`Week of ${w.week}: ${w.enrollments} enrollments, ${w.completions} completions`}>
              <div className="bar-pair">
                <div className="bar a" style={{ height: `${(w.enrollments / max) * 100}%` }} />
                <div className="bar b" style={{ height: `${(w.completions / max) * 100}%` }} />
              </div>
              <div className="bar-label">{w.week.slice(5)}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Assessments and reviews</h2>
        <div className="stats">
          <Stat value={`${a.assessments.quizPassRate}%`} label={`Quiz pass rate (${a.assessments.quizAttempts} attempts)`} />
          <Stat value={`${a.assessments.averageQuizScore}%`} label="Average quiz score" />
          <Stat value={a.assessments.submissionsApproved} label="Assignments approved" />
          <Stat value={a.assessments.submissionsSentBack} label="Sent back for revision" />
          <Stat value={`${a.reviews.averageReviewHours}h`} label="Average wait for review" />
          <Stat value={`${a.reviews.oldestOpenHours}h`} label="Oldest waiting submission" />
        </div>
      </section>

      <section>
        <h2>Rewards and integrity</h2>
        <div className="stats">
          <Stat value={a.rewards.pointsPaid} label="Points paid" />
          <Stat value={a.rewards.creditsPaid} label="Course credits paid" />
          <Stat value={a.rewards.costPerCompletion.points} label="Points per verified completion" />
          <Stat value={a.rewards.committed} label="Committed, not yet paid" />
          <Stat value={a.assessments.flaggedDuplicates} label="Flagged duplicate submissions" />
          <Stat value={`${a.integrity.appealsOverturned}/${a.integrity.appealsOverturned + a.integrity.appealsUpheld}`} label="Appeals overturned" />
          <Stat value={a.integrity.credentialsRevoked} label="Credentials revoked" />
          <Stat value={a.rewards.unfunded} label="Completions after budget ran out" />
        </div>
      </section>

      <section>
        <h2>By course</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th className="num">Enrolled</th>
                <th className="num">Completed</th>
                <th className="num">Rate</th>
                <th className="num">Avg days</th>
                <th className="num">Avg quiz</th>
              </tr>
            </thead>
            <tbody>
              {a.courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.title} {c.status !== 'published' && <span className="badge">{c.status}</span>}
                  </td>
                  <td className="num">{c.enrollments}</td>
                  <td className="num">{c.completions}</td>
                  <td className="num">{c.completionRate}%</td>
                  <td className="num">{c.avgDaysToComplete}</td>
                  <td className="num">{c.avgQuizScore ? `${c.avgQuizScore}%` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
