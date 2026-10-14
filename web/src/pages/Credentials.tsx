import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { brandProps, Empty, ErrorNotice, formatDate, Spinner, usePageTitle, useToast } from '../components/ui';
import type { CredentialRow } from '../types';

export function CredentialsPage() {
  usePageTitle('Credentials');
  const toast = useToast();
  const query = useQuery({ queryKey: ['credentials'], queryFn: () => get<{ credentials: CredentialRow[] }>('/api/me/credentials') });
  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container page">
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }
  const creds = query.data!.credentials;
  async function copy(publicId: string) {
    const url = `${window.location.origin}/verify/${publicId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Verification link copied.');
    } catch {
      prompt('Copy this link', url);
    }
  }
  return (
    <div className="container page">
      <h1>Credentials</h1>
      <p className="muted">
        Each credential has a public page anyone can open to check who issued it and whether it's still valid. Credentials stay with you
        and can't be transferred.
      </p>
      {creds.length === 0 ? (
        <Empty>No credentials yet. Complete a course that issues one.</Empty>
      ) : (
        <div className="grid">
          {creds.map((c) => (
            <div key={c.publicId} className="card card-accent" {...brandProps(c.accentColor)}>
              <div className="row between">
                <span className="small muted">{c.communityName}</span>
                {c.status === 'active' ? <span className="badge ok">Valid</span> : <span className="badge bad">Revoked</span>}
              </div>
              <h3 style={{ marginTop: 6 }}>{c.title}</h3>
              <p className="small muted">
                {c.courseTitle} (version {c.versionNumber}) · issued {formatDate(c.issuedAt)}
              </p>
              {c.status === 'revoked' && c.revokedReason && <p className="small">Reason: {c.revokedReason}</p>}
              <div className="row">
                <Link className="btn small" to={`/verify/${c.publicId}`}>
                  Open
                </Link>
                <button className="btn small" onClick={() => copy(c.publicId)}>
                  Copy link
                </button>
                <Link className="btn small ghost" to={`/certificate/${c.publicId}`}>
                  Certificate
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
