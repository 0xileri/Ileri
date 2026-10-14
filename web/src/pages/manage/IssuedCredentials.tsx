import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { Empty, ErrorNotice, formatDate, Spinner } from '../../components/ui';
import type { CredentialRow } from '../../types';
import { useManage } from './ManageRoutes';

export function IssuedCredentials() {
  const { community, isOwner } = useManage();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['issued-credentials', community.id],
    queryFn: () => get<{ credentials: CredentialRow[] }>(`/api/communities/${community.id}/credentials`),
  });
  const revoke = useMutation({
    mutationFn: ({ publicId, reason }: { publicId: string; reason: string }) => post(`/api/credentials/${publicId}/revoke`, { reason }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const creds = query.data!.credentials;
  return (
    <div className="stack">
      <p className="muted">
        Revoking a credential also revokes the completion behind it and releases any reward the learner hasn't claimed yet. Rewards
        already paid stay in the ledger and are noted in the audit log.
      </p>
      {revoke.error && <ErrorNotice error={revoke.error} />}
      {creds.length === 0 ? (
        <Empty>No credentials issued yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Credential</th>
                <th>Issued</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => (
                <tr key={c.publicId}>
                  <td>{c.recipientName}</td>
                  <td>
                    <Link to={`/verify/${c.publicId}`}>{c.title}</Link>
                    <div className="tiny muted">{c.courseTitle}</div>
                  </td>
                  <td className="small">{formatDate(c.issuedAt)}</td>
                  <td>
                    {c.status === 'active' ? <span className="badge ok">Active</span> : <span className="badge bad" title={c.revokedReason ?? ''}>Revoked</span>}
                  </td>
                  <td>
                    {isOwner && c.status === 'active' && (
                      <button
                        className="btn small danger"
                        onClick={() => {
                          const reason = prompt(`Why revoke ${c.recipientName}'s credential? This is recorded and shown on the verification page.`);
                          if (reason && reason.trim().length >= 5) revoke.mutate({ publicId: c.publicId, reason: reason.trim() });
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
