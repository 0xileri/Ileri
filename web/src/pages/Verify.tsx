import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { get } from '../api';
import { brandProps, CommunityLogo, ErrorNotice, formatDate, Spinner, usePageTitle } from '../components/ui';
import type { VerifyView } from '../types';

function useCredential() {
  const { publicId = '' } = useParams();
  return useQuery({ queryKey: ['verify', publicId], queryFn: () => get<VerifyView>(`/api/credentials/${publicId}`) });
}

export function VerifyPage() {
  const query = useCredential();
  usePageTitle(query.data ? `${query.data.credential.title} · Verification` : 'Verify credential');
  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container narrow page">
        <h1>Credential not found</h1>
        <p className="muted">Check that the link is complete. Credential links look like /verify/cred_…</p>
        <ErrorNotice error={query.error} />
      </div>
    );
  }
  const { credential: c, issuer, verification } = query.data!;
  return (
    <div className="container narrow page" {...brandProps(issuer.accentColor)}>
      <div className={`notice ${verification.valid ? 'ok' : 'bad'}`} style={{ marginBottom: 20 }} role="status">
        <strong>{verification.valid ? 'This credential is valid' : 'This credential is not valid'}</strong>
        {verification.valid
          ? `Issued by ${issuer.name} and checked just now.`
          : c.status === 'revoked'
            ? `Revoked on ${formatDate(c.revokedAt)}${c.revokedReason ? `: ${c.revokedReason}` : '.'}`
            : 'The issuing community is currently suspended.'}
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <CommunityLogo name={issuer.name} logoUrl={issuer.logoUrl} small />
          <div>
            <div className="small muted">Issued by</div>
            <Link to={`/c/${issuer.slug}`}>{issuer.name}</Link>
          </div>
        </div>
        <h1>{c.title}</h1>
        <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 16px', margin: 0 }}>
          <dt className="muted">Awarded to</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{c.recipientName}</dd>
          <dt className="muted">Course</dt>
          <dd style={{ margin: 0 }}>
            <Link to={`/courses/${c.courseId}`}>{c.courseTitle}</Link> (version {c.versionNumber})
          </dd>
          <dt className="muted">Issued</dt>
          <dd style={{ margin: 0 }}>{formatDate(c.issuedAt)}</dd>
          <dt className="muted">Criteria</dt>
          <dd style={{ margin: 0 }}>{c.criteria}</dd>
          <dt className="muted">Credential ID</dt>
          <dd style={{ margin: 0 }} className="mono">
            {c.publicId}
          </dd>
        </dl>
        <hr />
        <div className="row">
          <Link className="btn" to={`/certificate/${c.publicId}`}>
            Printable certificate
          </Link>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 14 }}>
        Ileri checks the issuer's records each time this page loads. A credential is tied to the person who earned it and can't be
        transferred with a wallet or token.
      </p>
    </div>
  );
}

export function CertificatePage() {
  const query = useCredential();
  usePageTitle('Certificate');
  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorNotice error={query.error ?? new Error('Not found')} />;
  const { credential: c, issuer, verification } = query.data;
  return (
    <div className="container narrow page" {...brandProps(issuer.accentColor)}>
      <div className="row between no-print" style={{ marginBottom: 16 }}>
        <Link to={`/verify/${c.publicId}`}>← Verification page</Link>
        <button className="btn" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <div className="certificate">
        <div className="row" style={{ justifyContent: 'center', marginBottom: 18 }}>
          <CommunityLogo name={issuer.name} logoUrl={issuer.logoUrl} small />
          <strong>{issuer.name}</strong>
        </div>
        <p className="muted" style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '0.8rem' }}>
          Certificate of completion
        </p>
        <h1>{c.title}</h1>
        <p className="muted">awarded to</p>
        <div className="recipient">{c.recipientName}</div>
        <p style={{ maxWidth: '52ch', margin: '0 auto 18px' }}>{c.criteria}</p>
        <p className="small muted">
          {c.courseTitle}, version {c.versionNumber} · {formatDate(c.issuedAt)}
        </p>
        {!verification.valid && <p className="badge bad">Revoked</p>}
        <p className="tiny muted mono" style={{ marginTop: 24 }}>
          Verify at {verification.verifyUrl}
        </p>
      </div>
    </div>
  );
}
