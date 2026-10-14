import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { ErrorNotice, Spinner, Stat } from '../../components/ui';
import type { Analytics } from './analyticsTypes';
import { useManage } from './ManageRoutes';

export function ManageOverview() {
  const { community, isOwner } = useManage();
  const base = `/manage/${community.slug}`;
  const analytics = useQuery({ queryKey: ['analytics', community.id], queryFn: () => get<Analytics>(`/api/communities/${community.id}/analytics`) });
  const claims = useQuery({
    queryKey: ['claims', community.id, 'submitted'],
    enabled: isOwner,
    queryFn: () => get<{ claims: unknown[] }>(`/api/communities/${community.id}/reward-claims`),
  });
  if (analytics.isLoading) return <Spinner />;
  if (analytics.error) return <ErrorNotice error={analytics.error} onRetry={() => analytics.refetch()} />;
  const a = analytics.data!;
  const todo = [
    a.reviews.open > 0 && { to: `${base}/reviews`, text: `${a.reviews.open} submissions waiting for review`, tone: 'warn' },
    isOwner && a.integrity.appealsOpen > 0 && { to: `${base}/appeals`, text: `${a.integrity.appealsOpen} open appeals`, tone: 'warn' },
    isOwner && (claims.data?.claims.length ?? 0) > 0 && { to: `${base}/rewards`, text: `${claims.data!.claims.length} reward claims to approve`, tone: 'info' },
  ].filter(Boolean) as { to: string; text: string; tone: string }[];
  return (
    <div className="stack">
      {todo.length > 0 ? (
        <div className="stack">
          {todo.map((t) => (
            <Link key={t.to} to={t.to} className={`notice ${t.tone}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              {t.text} →
            </Link>
          ))}
        </div>
      ) : (
        <p className="notice ok">Nothing waiting on you right now.</p>
      )}
      <div className="stats">
        <Stat value={a.summary.members} label="Members" />
        <Stat value={a.summary.enrollments} label="Enrollments" />
        <Stat value={a.summary.completions} label="Verified completions" />
        <Stat value={`${a.summary.completionRate}%`} label="Completion rate" />
        <Stat value={`${a.reviews.averageReviewHours}h`} label="Average review wait" />
        <Stat value={a.summary.returningLearners} label="Returning learners" />
      </div>
      <div className="row">
        <Link className="btn primary" to={`${base}/courses`}>
          Manage courses
        </Link>
        <Link className="btn" to={`${base}/analytics`}>
          Full analytics
        </Link>
        {isOwner && (
          <Link className="btn" to={`${base}/settings`}>
            Access rules and branding
          </Link>
        )}
      </div>
    </div>
  );
}
