import { Link } from 'react-router-dom';
import type { CourseCard as Course } from '../types';
import { plural, ProgressBar, rewardUnit, StageBadge } from './ui';

export function CourseCardView({ course }: { course: Course }) {
  const enrollment = course.myEnrollment;
  const live = course.campaigns.filter((c) => c.live);
  return (
    <Link className="card card-accent" to={enrollment ? `/learn/${course.id}` : `/courses/${course.id}`}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          {course.status !== 'published' && <span className="badge warn">{course.status === 'draft' ? 'Draft' : 'Archived'}</span>}
          {enrollment && <StageBadge stage={enrollment.stage} />}
          {course.creditCost > 0 && <span className="badge">{course.creditCost} credits</span>}
        </div>
        {course.hasCredential && <span className="badge accent">Credential</span>}
      </div>
      <h3>{course.title}</h3>
      {course.summary && <p className="muted small">{course.summary}</p>}
      <div className="meta">
        <span>{plural(course.lessonCount, 'lesson')}</span>
        {course.estimatedMinutes > 0 && <span>about {Math.max(5, Math.round(course.estimatedMinutes / 5) * 5)} min</span>}
      </div>
      <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>
        <span className="muted">Access: </span>
        {course.accessSummary}
      </p>
      {live.length > 0 && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          {live.map((c) => (
            <span key={c.id} className="badge ok" title={c.name}>
              Earn {rewardUnit(c.rewardKind, c.amountPerCompletion)}
              {c.remaining !== null ? ` · ${c.remaining} left` : ''}
            </span>
          ))}
        </div>
      )}
      {enrollment && (
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={enrollment.progressPercent} label={`${course.title} progress`} />
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {enrollment.progressPercent}% complete
          </div>
        </div>
      )}
    </Link>
  );
}
