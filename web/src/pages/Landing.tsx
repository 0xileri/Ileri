import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { brandProps, CommunityLogo, plural, usePageTitle } from '../components/ui';
import type { CommunityCard } from '../types';

export function Landing() {
  usePageTitle(undefined);
  const { user, openSignIn } = useAuth();
  const communities = useQuery({ queryKey: ['communities', ''], queryFn: () => get<{ communities: CommunityCard[] }>('/api/communities') });
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Learning your community can verify.</h1>
          <p className="lead">
            Communities open courses to their members, check what people actually learned, and reward the ones who finish. Tokens
            decide who gets in. Assessments decide who completed.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            {user ? (
              <Link className="btn primary" to="/dashboard">
                Go to your dashboard
              </Link>
            ) : (
              <button className="btn primary" onClick={openSignIn}>
                Sign in with your wallet
              </button>
            )}
            <Link className="btn" to="/communities">
              Explore communities
            </Link>
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="steps">
          <div className="card flat step">
            <h3>Join</h3>
            <p className="muted small">Connect a wallet. If the community uses a membership token, we check it for you.</p>
          </div>
          <div className="card flat step">
            <h3>Learn</h3>
            <p className="muted small">Work through lessons on any device and pick up where you left off.</p>
          </div>
          <div className="card flat step">
            <h3>Prove it</h3>
            <p className="muted small">Pass a quiz graded on the server and get practical work approved by a reviewer.</p>
          </div>
          <div className="card flat step">
            <h3>Earn</h3>
            <p className="muted small">Get a credential anyone can verify, plus points or course credits the community funds.</p>
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="section-title">
          <h2>Communities</h2>
          <Link to="/communities">See all</Link>
        </div>
        <div className="grid">
          {(communities.data?.communities ?? []).slice(0, 6).map((c) => (
            <Link key={c.id} to={`/c/${c.slug}`} className="card card-accent" {...brandProps(c.accentColor)}>
              <div className="row" style={{ marginBottom: 10 }}>
                <CommunityLogo name={c.name} logoUrl={c.logoUrl} small />
                <h3 style={{ margin: 0 }}>{c.name}</h3>
              </div>
              <p className="muted small">{c.tagline}</p>
              <div className="meta">
                <span>{plural(c.memberCount, 'member')}</span>
                <span>{plural(c.courseCount, 'course')}</span>
              </div>
            </Link>
          ))}
        </div>
        {communities.data && communities.data.communities.length === 0 && <p className="muted">No public communities yet.</p>}
      </section>

      <section className="container section">
        <div className="card">
          <h2>Running a community?</h2>
          <p className="muted">
            Owning a token gets someone in the door. It doesn't show they learned anything. Ileri keeps access, verification and rewards
            as separate decisions you control: who can enter, what counts as finishing, and what finishing is worth.
          </p>
          <Link className="btn" to={user ? '/new-community' : '/communities'}>
            {user ? 'Start a community' : 'Look around first'}
          </Link>
        </div>
      </section>
    </>
  );
}
