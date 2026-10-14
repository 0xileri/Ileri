import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { brandProps, CommunityLogo, Empty, ErrorNotice, plural, Spinner, usePageTitle } from '../components/ui';
import type { CommunityCard } from '../types';

export function Communities() {
  usePageTitle('Communities');
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['communities', q],
    queryFn: () => get<{ communities: CommunityCard[] }>(`/api/communities?q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="container page">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Communities</h1>
        {user && (
          <Link className="btn" to="/new-community">
            Start a community
          </Link>
        )}
      </div>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="community-search" className="sr-only">
          Search communities
        </label>
        <input id="community-search" type="search" placeholder="Search communities" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
      {query.data && query.data.communities.length === 0 && <Empty>No communities match that search.</Empty>}
      <div className="grid">
        {query.data?.communities.map((c) => (
          <Link key={c.id} to={`/c/${c.slug}`} className="card card-accent" {...brandProps(c.accentColor)}>
            <div className="row" style={{ marginBottom: 10 }}>
              <CommunityLogo name={c.name} logoUrl={c.logoUrl} small />
              <div className="spacer">
                <h3 style={{ margin: 0 }}>{c.name}</h3>
              </div>
              {c.myRole && <span className="badge accent">{c.myRole === 'member' ? 'Member' : c.myRole === 'owner' ? 'Owner' : 'Instructor'}</span>}
            </div>
            {c.tagline && <p className="muted small">{c.tagline}</p>}
            <div className="meta">
              <span>{plural(c.memberCount, 'member')}</span>
              <span>{plural(c.courseCount, 'course')}</span>
            </div>
            <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>
              <span className="muted">To join: </span>
              {c.joinSummary}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
