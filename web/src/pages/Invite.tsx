import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { CommunityLogo, ErrorNotice, formatDate, Spinner, usePageTitle } from '../components/ui';

export function InvitePage() {
  usePageTitle('Invitation');
  const { token = '' } = useParams();
  const { user, openSignIn } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['invite', token],
    queryFn: () =>
      get<{ invite: { role: string; note: string; expiresAt: string }; community: { name: string; slug: string; logoUrl: string | null } }>(
        `/api/invites/${token}`,
      ),
  });
  const accept = useMutation({
    mutationFn: () => post<{ communitySlug: string }>(`/api/invites/${token}/accept`),
    onSuccess: async (data) => {
      await qc.invalidateQueries();
      navigate(`/manage/${data.communitySlug}`);
    },
  });
  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container narrow page">
        <h1>Invitation unavailable</h1>
        <ErrorNotice error={query.error} />
      </div>
    );
  }
  const { invite, community } = query.data!;
  return (
    <div className="container narrow page">
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <CommunityLogo name={community.name} logoUrl={community.logoUrl} />
          <div>
            <p className="muted small" style={{ margin: 0 }}>
              You're invited to join
            </p>
            <h1 style={{ margin: 0 }}>{community.name}</h1>
          </div>
        </div>
        <p>
          as <strong>{invite.role === 'owner' ? 'an owner' : 'an instructor'}</strong>. This invitation expires {formatDate(invite.expiresAt)}.
        </p>
        {invite.note && <p className="muted">"{invite.note}"</p>}
        {user ? (
          <button className="btn primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
            Accept invitation
          </button>
        ) : (
          <button className="btn primary" onClick={openSignIn}>
            Sign in to accept
          </button>
        )}
        {accept.error && <ErrorNotice error={accept.error} />}
      </div>
    </div>
  );
}
