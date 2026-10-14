import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { brandProps, Empty, ErrorNotice, formatDate, ProgressBar, rewardUnit, Spinner, StageBadge, usePageTitle } from '../components/ui';
import type { CampaignSummary, EnrollmentSummary } from '../types';

interface DashboardData {
  continueLearning: Enrolled[];
  completed: Enrolled[];
  available: {
    id: string;
    title: string;
    summary: string;
    creditCost: number;
    communityName: string;
    communitySlug: string;
    accentColor: string;
    eligibility: 'eligible' | 'ineligible' | 'unknown' | 'open';
    accessSummary: string;
    campaigns: CampaignSummary[];
  }[];
  credentials: { publicId: string; title: string; courseTitle: string; issuedAt: string; status: string; communityName: string }[];
  claimableRewards: number;
}

interface Enrolled {
  id: string;
  title: string;
  summary: string;
  communityName: string;
  communitySlug: string;
  accentColor: string;
  enrollment: EnrollmentSummary;
}

export function Dashboard() {
  usePageTitle('Dashboard');
  const { user, me } = useAuth();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/api/me/dashboard') });
  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container page">
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }
  const data = query.data!;
  const eligible = data.available.filter((c) => c.eligibility === 'eligible' || c.eligibility === 'open');
  const locked = data.available.filter((c) => c.eligibility === 'ineligible' || c.eligibility === 'unknown');
  const noCommunities = (me?.memberships ?? []).length === 0;

  return (
    <div className="container page">
      <h1>Welcome back, {user?.displayName}</h1>
      {data.claimableRewards > 0 && (
        <div className="notice ok" style={{ marginBottom: 20 }}>
          <div className="row between">
            <span>
              You have {data.claimableRewards} {data.claimableRewards === 1 ? 'reward' : 'rewards'} ready to claim.
            </span>
            <Link className="btn small primary" to="/rewards">
              Claim now
            </Link>
          </div>
        </div>
      )}

      <section className="section">
        <div className="section-title">
          <h2>Continue learning</h2>
        </div>
        {data.continueLearning.length === 0 ? (
          <Empty>Nothing in progress. Pick a course below to get started.</Empty>
        ) : (
          <div className="grid">
            {data.continueLearning.map((c) => (
              <Link key={c.id} to={`/learn/${c.id}`} className="card card-accent" {...brandProps(c.accentColor)}>
                <div className="row between">
                  <span className="small muted">{c.communityName}</span>
                  <StageBadge stage={c.enrollment.stage} />
                </div>
                <h3 style={{ marginTop: 6 }}>{c.title}</h3>
                <ProgressBar value={c.enrollment.progressPercent} label={`${c.title} progress`} />
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {c.enrollment.progressPercent}% · last active {formatDate(c.enrollment.lastActivityAt)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>What you can learn</h2>
          <Link to="/communities">Find communities</Link>
        </div>
        {noCommunities ? (
          <Empty>
            Join a community to see its courses.{' '}
            <Link to="/communities" className="btn small" style={{ marginLeft: 8 }}>
              Explore
            </Link>
          </Empty>
        ) : eligible.length === 0 && locked.length === 0 ? (
          <Empty>You've started every course in your communities.</Empty>
        ) : (
          <div className="grid">
            {[...eligible, ...locked].map((c) => (
              <Link key={c.id} to={`/courses/${c.id}`} className="card card-accent" {...brandProps(c.accentColor)}>
                <div className="row between">
                  <span className="small muted">{c.communityName}</span>
                  {c.eligibility === 'eligible' || c.eligibility === 'open' ? (
                    <span className="badge ok">You qualify</span>
                  ) : c.eligibility === 'unknown' ? (
                    <span className="badge warn">Can't check now</span>
                  ) : (
                    <span className="badge">Locked</span>
                  )}
                </div>
                <h3 style={{ marginTop: 6 }}>{c.title}</h3>
                {c.summary && <p className="small muted">{c.summary}</p>}
                {c.eligibility === 'ineligible' && <p className="small" style={{ margin: 0 }}>To unlock: {c.accessSummary}</p>}
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  {c.creditCost > 0 && <span className="badge">{c.creditCost} credits</span>}
                  {c.campaigns.map((k) => (
                    <span key={k.id} className="badge ok">
                      Earn {rewardUnit(k.rewardKind, k.amountPerCompletion)}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>What you've earned</h2>
          <Link to="/credentials">All credentials</Link>
        </div>
        {data.credentials.length === 0 && data.completed.length === 0 ? (
          <Empty>Complete a course to earn your first credential.</Empty>
        ) : (
          <div className="grid">
            {data.credentials.map((c) => (
              <Link key={c.publicId} to={`/verify/${c.publicId}`} className="card">
                <div className="row between">
                  <span className="small muted">{c.communityName}</span>
                  {c.status === 'active' ? <span className="badge ok">Verified</span> : <span className="badge bad">Revoked</span>}
                </div>
                <h3 style={{ marginTop: 6 }}>{c.title}</h3>
                <p className="small muted" style={{ margin: 0 }}>
                  {c.courseTitle} · {formatDate(c.issuedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
