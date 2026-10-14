import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { Empty, ErrorNotice, Field, formatDate, Spinner } from '../../components/ui';
import { useManage } from './ManageRoutes';

export interface AppealRow {
  id: string;
  status: 'open' | 'upheld' | 'overturned';
  reason: string;
  resolutionNote: string;
  createdAt: string;
  resolvedAt: string | null;
  submissionId: string;
  communityId: string;
  learnerName: string;
  courseTitle: string;
  reviewerId: string | null;
  community?: { name: string; slug: string } | null;
}

export function AppealCard({ appeal, reviewLink }: { appeal: AppealRow; reviewLink: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: (outcome: 'upheld' | 'overturned') => post(`/api/appeals/${appeal.id}/resolve`, { outcome, note }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const ownDecision = appeal.reviewerId === user?.id && !user?.isPlatformAdmin;
  return (
    <div className="card flat">
      <div className="row between">
        <strong>
          {appeal.learnerName} · {appeal.courseTitle}
        </strong>
        <span className={`badge ${appeal.status === 'open' ? 'warn' : appeal.status === 'overturned' ? 'ok' : ''}`}>{appeal.status}</span>
      </div>
      <p className="tiny muted">
        Filed {formatDate(appeal.createdAt)}
        {appeal.community ? ` · ${appeal.community.name}` : ''}
      </p>
      <blockquote className="prose small" style={{ margin: '8px 0' }}>
        {appeal.reason}
      </blockquote>
      <Link to={reviewLink} className="small">
        Open the submission and its review history
      </Link>
      {appeal.status === 'open' ? (
        ownDecision ? (
          <p className="notice small" style={{ marginTop: 10 }}>You reviewed this submission, so another owner needs to decide the appeal.</p>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Field label="Decision note (shared with the learner)" htmlFor={`note-${appeal.id}`}>
              <textarea id={`note-${appeal.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="row">
              <button className="btn primary" disabled={!note.trim() || resolve.isPending} onClick={() => resolve.mutate('overturned')}>
                Overturn and approve
              </button>
              <button className="btn" disabled={!note.trim() || resolve.isPending} onClick={() => resolve.mutate('upheld')}>
                Keep the decision
              </button>
            </div>
            {resolve.error && <ErrorNotice error={resolve.error} />}
          </div>
        )
      ) : (
        appeal.resolutionNote && <p className="small" style={{ marginTop: 8 }}>Resolution: {appeal.resolutionNote}</p>
      )}
    </div>
  );
}

export function AppealsPage() {
  const { community } = useManage();
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ['appeals', community.id, all],
    queryFn: () => get<{ appeals: AppealRow[] }>(`/api/communities/${community.id}/appeals${all ? '?status=all' : ''}`),
  });
  return (
    <div className="stack">
      <p className="muted">
        Learners can appeal a "revision required" decision once. The reviewer who made the decision can't resolve its appeal.
      </p>
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Show resolved appeals
      </label>
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data && query.data.appeals.length === 0 && <Empty>No {all ? '' : 'open '}appeals.</Empty>}
      {query.data?.appeals.map((a) => (
        <AppealCard key={a.id} appeal={a} reviewLink={`/manage/${community.slug}/reviews/${a.submissionId}`} />
      ))}
    </div>
  );
}
