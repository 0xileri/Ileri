import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { Empty, ErrorNotice, formatDate, Spinner, Stat, timeAgo, usePageTitle } from '../../components/ui';
import { AppealCard, type AppealRow } from '../manage/Appeals';
import { AuditTable, type AuditEvent } from '../manage/Audit';

export default function AdminPage() {
  usePageTitle('Platform admin');
  const { user } = useAuth();
  if (!user?.isPlatformAdmin) {
    return (
      <div className="container narrow page">
        <h1>Administrators only</h1>
        <p className="muted">This area is for platform operators.</p>
      </div>
    );
  }
  const tabs = [
    { to: '/admin', label: 'Health', end: true },
    { to: '/admin/communities', label: 'Communities' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/disputes', label: 'Disputes' },
    { to: '/admin/audit', label: 'Audit log' },
  ];
  return (
    <div className="container page">
      <h1>Platform admin</h1>
      <nav className="tabs" aria-label="Admin">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Health />} />
        <Route path="communities" element={<CommunitiesAdmin />} />
        <Route path="users" element={<UsersAdmin />} />
        <Route path="disputes" element={<Disputes />} />
        <Route path="audit" element={<GlobalAudit />} />
      </Routes>
    </div>
  );
}

interface Overview {
  totals: Record<string, number>;
  health: {
    database: { ok: boolean; kind: string };
    chain: { mode: string; supportedChainIds: number[]; lastSuccessAt?: string | null; lastFailureAt?: string | null; lastError?: string | null; consecutiveFailures?: number };
    jobs: Record<string, { lastRunAt: string | null; lastError: string | null; lastResult: Record<string, number> | null }>;
    uptimeSeconds: number;
  };
}

function Health() {
  const query = useQuery({ queryKey: ['admin-overview'], queryFn: () => get<Overview>('/api/admin/overview'), refetchInterval: 30_000 });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const { totals, health } = query.data!;
  const chainOk = (health.chain.consecutiveFailures ?? 0) === 0;
  return (
    <div className="stack">
      <div className="grid">
        <div className="card flat">
          <h3>Database</h3>
          <span className={`badge ${health.database.ok ? 'ok' : 'bad'}`}>{health.database.ok ? 'Healthy' : 'Unreachable'}</span>
          <p className="small muted" style={{ marginTop: 8 }}>{health.database.kind === 'pglite' ? 'Embedded PGlite (development)' : 'PostgreSQL'}</p>
        </div>
        <div className="card flat">
          <h3>Blockchain reads</h3>
          <span className={`badge ${chainOk ? 'ok' : 'warn'}`}>{chainOk ? 'Healthy' : `${health.chain.consecutiveFailures} failures in a row`}</span>
          <p className="small muted" style={{ marginTop: 8 }}>
            Mode: {health.chain.mode}. Chains: {health.chain.supportedChainIds.join(', ')}.
            {health.chain.lastSuccessAt && ` Last success ${timeAgo(health.chain.lastSuccessAt)}.`}
          </p>
          {health.chain.lastError && !chainOk && <p className="small" style={{ color: 'var(--bad)' }}>{health.chain.lastError}</p>}
        </div>
        <div className="card flat">
          <h3>Background jobs</h3>
          {Object.keys(health.jobs).length === 0 ? (
            <p className="small muted">No runs yet.</p>
          ) : (
            Object.entries(health.jobs).map(([name, j]) => (
              <p key={name} className="small" style={{ margin: '4px 0' }}>
                <code>{name}</code> {j.lastError ? <span className="badge bad">error</span> : <span className="badge ok">ok</span>}{' '}
                <span className="muted">{j.lastRunAt ? timeAgo(j.lastRunAt) : ''}</span>
              </p>
            ))
          )}
        </div>
      </div>
      <div className="stats">
        <Stat value={totals.users ?? 0} label="Users" />
        <Stat value={totals.communities ?? 0} label="Communities" />
        <Stat value={totals.published_courses ?? 0} label="Published courses" />
        <Stat value={totals.enrollments ?? 0} label="Enrollments" />
        <Stat value={totals.completions ?? 0} label="Verified completions" />
        <Stat value={totals.open_reviews ?? 0} label="Submissions waiting" />
        <Stat value={totals.open_appeals ?? 0} label="Open appeals" />
        <Stat value={totals.pending_claims ?? 0} label="Claims awaiting approval" />
      </div>
    </div>
  );
}

function CommunitiesAdmin() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['admin-communities', q],
    queryFn: () =>
      get<{ communities: { id: string; slug: string; name: string; status: string; visibility: string; createdAt: string; members: number; courses: number }[] }>(
        `/api/admin/communities?q=${encodeURIComponent(q)}`,
      ),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) => post(`/api/admin/communities/${id}/status`, { status, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-communities'] }),
  });
  return (
    <div className="stack">
      <input type="search" placeholder="Search communities" aria-label="Search communities" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {setStatus.error && <ErrorNotice error={setStatus.error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Community</th>
              <th className="num">Members</th>
              <th className="num">Courses</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.communities.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/c/${c.slug}`}>{c.name}</Link>
                  {c.visibility === 'unlisted' && <span className="tiny muted"> · unlisted</span>}
                </td>
                <td className="num">{c.members}</td>
                <td className="num">{c.courses}</td>
                <td className="small">{formatDate(c.createdAt)}</td>
                <td>
                  <span className={`badge ${c.status === 'active' ? 'ok' : 'bad'}`}>{c.status}</span>
                </td>
                <td>
                  <button
                    className={`btn small ${c.status === 'active' ? 'danger' : ''}`}
                    onClick={() => {
                      const next = c.status === 'active' ? 'suspended' : 'active';
                      const reason = prompt(`Reason to ${next === 'suspended' ? 'suspend' : 'reinstate'} ${c.name} (recorded in the audit log)`);
                      if (reason && reason.trim().length >= 3) setStatus.mutate({ id: c.id, status: next, reason: reason.trim() });
                    }}
                  >
                    {c.status === 'active' ? 'Suspend' : 'Reinstate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersAdmin() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['admin-users', q],
    queryFn: () =>
      get<{ users: { id: string; displayName: string; status: string; isPlatformAdmin: boolean; createdAt: string; wallets: string[]; communities: number }[] }>(
        `/api/admin/users?q=${encodeURIComponent(q)}`,
      ),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) => post(`/api/admin/users/${id}/status`, { status, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  return (
    <div className="stack">
      <input type="search" placeholder="Search by name or 0x address" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {setStatus.error && <ErrorNotice error={setStatus.error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Wallets</th>
              <th className="num">Communities</th>
              <th>Joined</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.displayName} {u.isPlatformAdmin && <span className="badge accent">admin</span>}
                </td>
                <td className="mono small">{u.wallets.join(', ')}</td>
                <td className="num">{u.communities}</td>
                <td className="small">{formatDate(u.createdAt)}</td>
                <td>
                  <span className={`badge ${u.status === 'active' ? 'ok' : 'bad'}`}>{u.status}</span>
                </td>
                <td>
                  {u.id !== me?.id && (
                    <button
                      className={`btn small ${u.status === 'active' ? 'danger' : ''}`}
                      onClick={() => {
                        const next = u.status === 'active' ? 'suspended' : 'active';
                        const reason = prompt(`Reason to ${next === 'suspended' ? 'suspend' : 'reinstate'} ${u.displayName}`);
                        if (reason && reason.trim().length >= 3) setStatus.mutate({ id: u.id, status: next, reason: reason.trim() });
                      }}
                    >
                      {u.status === 'active' ? 'Suspend' : 'Reinstate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Disputes() {
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ['admin-appeals', all],
    queryFn: () => get<{ appeals: AppealRow[] }>(`/api/admin/appeals${all ? '?status=all' : ''}`),
  });
  return (
    <div className="stack">
      <p className="muted">Appeals across every community. Community owners normally resolve these; step in when a community can't.</p>
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Include resolved
      </label>
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data && query.data.appeals.length === 0 && <Empty>No appeals.</Empty>}
      {query.data?.appeals.map((a) => (
        <AppealCard key={a.id} appeal={a} reviewLink={a.community ? `/manage/${a.community.slug}/reviews/${a.submissionId}` : '#'} />
      ))}
    </div>
  );
}

function GlobalAudit() {
  const [action, setAction] = useState('');
  const query = useQuery({
    queryKey: ['admin-audit', action],
    queryFn: () => get<{ events: AuditEvent[] }>(`/api/admin/audit?action=${encodeURIComponent(action)}`),
  });
  return (
    <div className="stack">
      <input placeholder="Filter by action prefix, e.g. admin. or credential." aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 360 }} />
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data && <AuditTable events={query.data.events} />}
    </div>
  );
}
