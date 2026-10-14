import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api';
import { Empty, ErrorNotice, formatDate, Spinner } from '../../components/ui';
import { useManage } from './ManageRoutes';

export interface AuditEvent {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
  communityId: string | null;
}

export function AuditTable({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <Empty>No events.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>
                {formatDate(e.createdAt, true)}
              </td>
              <td className="small">{e.actorName ?? 'System'}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td className="small">
                {e.targetType && (
                  <span className="muted">
                    {e.targetType} <span className="mono">{e.targetId?.slice(0, 18)}</span>
                  </span>
                )}
                {Object.keys(e.metadata ?? {}).length > 0 && (
                  <details>
                    <summary style={{ cursor: 'pointer' }}>metadata</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(e.metadata, null, 2)}</pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const { community } = useManage();
  const [action, setAction] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['audit', community.id, action, before],
    queryFn: () =>
      get<{ events: AuditEvent[] }>(
        `/api/communities/${community.id}/audit?action=${encodeURIComponent(action)}${before ? `&before=${before}` : ''}`,
      ),
  });
  const events = query.data?.events ?? [];
  return (
    <div className="stack">
      <div className="row">
        <select aria-label="Filter by action" value={action} onChange={(e) => { setAction(e.target.value); setBefore(null); }} style={{ width: 'auto' }}>
          <option value="">All actions</option>
          {['community.', 'member.', 'invite.', 'course.', 'enrollment.', 'submission.', 'appeal.', 'completion.', 'credential.', 'campaign.', 'reward.', 'ledger.', 'media.'].map((a) => (
            <option key={a} value={a}>
              {a.replace('.', '')}
            </option>
          ))}
        </select>
        {before && (
          <button className="btn small" onClick={() => setBefore(null)}>
            Newest
          </button>
        )}
      </div>
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data && <AuditTable events={events} />}
      {events.length === 100 && (
        <button className="btn" onClick={() => setBefore(events[events.length - 1]!.id)}>
          Older events
        </button>
      )}
    </div>
  );
}
