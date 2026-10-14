import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get, post } from '../api';
import { Empty, ErrorNotice, formatDate, RewardBadge, rewardHelp, rewardUnit, Spinner, usePageTitle, useToast } from '../components/ui';
import type { RewardRow } from '../types';

interface RewardsData {
  rewards: RewardRow[];
  balances: { communityId: string; communityName: string; communitySlug: string; kind: 'points' | 'course_credits'; balance: number }[];
  ledger: { id: string; kind: 'points' | 'course_credits'; amount: number; reason: string; memo: string; createdAt: string; communityName: string }[];
}

export function RewardsPage() {
  usePageTitle('Rewards');
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['rewards'], queryFn: () => get<RewardsData>('/api/me/rewards') });
  const claim = useMutation({
    mutationFn: (id: string) => post<{ reward: { status: string } }>(`/api/me/rewards/${id}/claim`),
    onSuccess: (data) => {
      toast(data.reward.status === 'confirmed' ? 'Reward added to your balance.' : 'Claim sent for approval.');
      qc.invalidateQueries();
    },
    onError: () => qc.invalidateQueries({ queryKey: ['rewards'] }),
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container page">
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }
  const { rewards, balances, ledger } = query.data!;
  return (
    <div className="container page">
      <h1>Rewards</h1>
      <p className="muted">Rewards are funded by each community and kept separate from what you pay to take part.</p>

      <section className="section">
        <h2>Balances</h2>
        {balances.length === 0 ? (
          <Empty>No balances yet. Completing a course with an active campaign earns points or course credits.</Empty>
        ) : (
          <div className="stats">
            {balances.map((b) => (
              <div key={`${b.communityId}-${b.kind}`} className="card tight flat stat">
                <span className="value">{b.balance}</span>
                <span className="label">
                  {b.kind === 'points' ? 'points' : 'course credits'} · <Link to={`/c/${b.communitySlug}`}>{b.communityName}</Link>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Your rewards</h2>
        {rewards.length === 0 ? (
          <Empty>No rewards yet.</Empty>
        ) : (
          <div className="stack">
            {rewards.map((r) => (
              <div key={r.id} className="card flat">
                <div className="row between">
                  <div>
                    <strong>{rewardUnit(r.rewardKind, r.amount)}</strong>
                    <span className="muted"> · {r.campaignName}</span>
                  </div>
                  <RewardBadge status={r.status} />
                </div>
                <p className="small muted" style={{ margin: '4px 0' }}>
                  <Link to={`/courses/${r.courseId}`}>{r.courseTitle}</Link> · {r.communityName}
                </p>
                <p className="small" style={{ marginBottom: 0 }}>
                  {r.note || rewardHelp(r.status)}
                  {r.claimDeadline && r.status === 'eligible' && ` Claim by ${formatDate(r.claimDeadline)}.`}
                </p>
                {(r.status === 'eligible' || r.status === 'failed') && (
                  <button
                    className="btn primary small"
                    style={{ marginTop: 10 }}
                    disabled={claim.isPending}
                    onClick={() => claim.mutate(r.id)}
                  >
                    {r.requiresApproval ? 'Request payout' : 'Claim'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {claim.error && <ErrorNotice error={claim.error} />}
      </section>

      {ledger.length > 0 && (
        <section className="section">
          <h2>History</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Community</th>
                  <th>Details</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDate(l.createdAt)}</td>
                    <td>{l.communityName}</td>
                    <td>
                      {l.reason === 'reward' ? 'Reward' : l.reason === 'enrollment' ? 'Enrollment' : 'Adjustment'}
                      {l.memo && <span className="muted"> · {l.memo}</span>}
                    </td>
                    <td className="num">
                      {l.amount > 0 ? '+' : ''}
                      {l.amount} {l.kind === 'points' ? 'pts' : 'credits'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
