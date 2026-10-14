import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { Empty, ErrorNotice, Field, formatDate, Markdown, Spinner, SubmissionBadge, timeAgo, useToast } from '../../components/ui';
import type { Assignment } from '../../../../shared/src/content';
import type { ReviewRecord } from '../../types';
import { useManage } from './ManageRoutes';

interface QueueRow {
  id: string;
  status: string;
  attemptNumber: number;
  createdAt: string;
  claimedAt: string | null;
  decidedAt: string | null;
  duplicateOfId: string | null;
  learnerName: string;
  courseTitle: string;
  reviewerId: string | null;
  reviewerName: string | null;
  appealStatus: string | null;
}

export function ReviewQueue() {
  const { community } = useManage();
  const [tab, setTab] = useState<'open' | 'decided'>('open');
  const query = useQuery({
    queryKey: ['review-queue', community.id, tab],
    queryFn: () => get<{ submissions: QueueRow[] }>(`/api/communities/${community.id}/review-queue?status=${tab}`),
  });
  return (
    <div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
          Waiting
        </button>
        <button role="tab" aria-selected={tab === 'decided'} className={tab === 'decided' ? 'active' : ''} onClick={() => setTab('decided')}>
          Decided
        </button>
      </div>
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data && query.data.submissions.length === 0 && (
        <Empty>{tab === 'open' ? 'Nothing waiting for review.' : 'No decisions yet.'}</Empty>
      )}
      {query.data && query.data.submissions.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Learner</th>
                <th>Course</th>
                <th>{tab === 'open' ? 'Waiting' : 'Decided'}</th>
                <th>Status</th>
                <th>Flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data.submissions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.learnerName}
                    {s.attemptNumber > 1 && <div className="tiny muted">attempt {s.attemptNumber}</div>}
                  </td>
                  <td className="small">{s.courseTitle}</td>
                  <td className="small">{tab === 'open' ? timeAgo(s.createdAt) : formatDate(s.decidedAt)}</td>
                  <td>
                    <SubmissionBadge status={s.status} />
                    {s.reviewerName && <div className="tiny muted">{s.reviewerName}</div>}
                  </td>
                  <td>
                    {s.duplicateOfId && <span className="badge bad">Possible copy</span>}{' '}
                    {s.appealStatus && <span className="badge warn">Appeal {s.appealStatus}</span>}
                  </td>
                  <td>
                    <Link className="btn small" to={`/manage/${community.slug}/reviews/${s.id}`}>
                      {tab === 'open' ? 'Review' : 'View'}
                    </Link>
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

interface SubmissionDetail {
  viewerIsStaff: boolean;
  course: { id: string; title: string };
  learner: { id: string; displayName: string };
  assignment: Assignment | null;
  versionNumber: number;
  submission: {
    id: string;
    status: string;
    attemptNumber: number;
    text: string;
    linkUrl: string | null;
    file: { url: string } | null;
    createdAt: string;
    reviewerId: string | null;
    duplicateOfId: string | null;
  };
  history: {
    id: string;
    attemptNumber: number;
    status: string;
    text: string;
    linkUrl: string | null;
    file: { url: string } | null;
    createdAt: string;
    reviews: (ReviewRecord & { reviewerName: string })[];
  }[];
  appeal: { status: string; reason: string; resolutionNote: string } | null;
  duplicate: { id: string; learnerName: string; createdAt: string } | null;
}

export function ReviewDetail() {
  const { submissionId = '' } = useParams();
  const { community } = useManage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['submission', submissionId], queryFn: () => get<SubmissionDetail>(`/api/submissions/${submissionId}`) });
  const [scores, setScores] = useState<Record<string, { met: boolean | null; note: string }>>({});
  const [comment, setComment] = useState('');
  const claim = useMutation({
    mutationFn: () => post(`/api/submissions/${submissionId}/claim`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submission', submissionId] }),
  });
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'revision_required') =>
      post<{ courseCompleted: boolean }>(`/api/submissions/${submissionId}/review`, {
        decision,
        comment,
        rubric: Object.entries(scores).map(([criterionId, s]) => ({ criterionId, met: Boolean(s.met), note: s.note || undefined })),
      }),
    onSuccess: (data, decision) => {
      toast(decision === 'approved' ? (data.courseCompleted ? 'Approved. The learner completed the course.' : 'Approved.') : 'Sent back for revision.');
      qc.invalidateQueries();
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const d = query.data!;
  const rubric = d.assignment?.rubric ?? [];
  const open = d.submission.status === 'submitted' || d.submission.status === 'under_review';
  const allScored = rubric.every((c) => scores[c.id]?.met !== undefined && scores[c.id]?.met !== null);
  const requiredUnmet = rubric.filter((c) => c.required && scores[c.id]?.met === false);
  const isOwnWork = d.learner.id === user?.id;

  return (
    <div className="split">
      <div className="stack">
        <Link to={`/manage/${community.slug}/reviews`} className="small">
          ← Review queue
        </Link>
        <div className="card">
          <div className="row between">
            <div>
              <h2 style={{ margin: 0 }}>{d.learner.displayName}</h2>
              <div className="small muted">
                {d.course.title} · version {d.versionNumber} · attempt {d.submission.attemptNumber} · {formatDate(d.submission.createdAt, true)}
              </div>
            </div>
            <SubmissionBadge status={d.submission.status} />
          </div>
          {d.duplicate && (
            <div className="notice bad small" style={{ marginTop: 12 }}>
              <strong>Possible copied work</strong>
              This matches a submission by {d.duplicate.learnerName} from {formatDate(d.duplicate.createdAt)}. Check before approving.
            </div>
          )}
          {d.appeal && (
            <div className="notice warn small" style={{ marginTop: 12 }}>
              <strong>Appeal {d.appeal.status}</strong>
              {d.appeal.reason}
            </div>
          )}
          <hr />
          {d.submission.text ? <Markdown source={d.submission.text} /> : <p className="muted">No written response.</p>}
          {d.submission.linkUrl && (
            <p>
              Link:{' '}
              <a href={d.submission.linkUrl} target="_blank" rel="noreferrer noopener">
                {d.submission.linkUrl}
              </a>
            </p>
          )}
          {d.submission.file && (
            <p>
              <a href={d.submission.file.url} target="_blank" rel="noreferrer">
                Open attached file
              </a>
            </p>
          )}
        </div>
        {d.history.length > 1 && (
          <section>
            <h3>Earlier attempts</h3>
            {d.history
              .filter((h) => h.id !== d.submission.id)
              .map((h) => (
                <details key={h.id} className="editor-block">
                  <summary>
                    Attempt {h.attemptNumber} <SubmissionBadge status={h.status} />
                  </summary>
                  <div className="editor-body">
                    <Markdown source={h.text || '_No written response._'} className="prose small" />
                    {h.reviews.map((r, i) => (
                      <p key={i} className="small">
                        <strong>{r.reviewerName}:</strong> {r.decision === 'approved' ? 'approved' : 'revision requested'}. {r.comment}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
          </section>
        )}
        {d.assignment && (
          <details className="editor-block">
            <summary>Assignment instructions</summary>
            <div className="editor-body">
              <Markdown source={d.assignment.prompt} />
            </div>
          </details>
        )}
      </div>

      <aside className="stack">
        {open ? (
          isOwnWork ? (
            <p className="notice">You can't review your own work. Another instructor or owner needs to.</p>
          ) : (
            <div className="card">
              <h3>Your review</h3>
              {d.submission.status === 'submitted' && (
                <button className="btn small block" style={{ marginBottom: 14 }} onClick={() => claim.mutate()} disabled={claim.isPending}>
                  Mark as under review
                </button>
              )}
              {d.submission.status === 'under_review' && d.submission.reviewerId !== user?.id && (
                <p className="notice warn small">Someone else claimed this. You can still decide if they're unavailable.</p>
              )}
              {rubric.map((c) => (
                <fieldset key={c.id} style={{ marginBottom: 14 }}>
                  <legend className="small">
                    {c.title} {c.required ? <span className="badge">required</span> : <span className="tiny muted">(optional)</span>}
                  </legend>
                  {c.description && <p className="tiny muted" style={{ margin: '0 0 6px' }}>{c.description}</p>}
                  <div className="row" style={{ gap: 6 }}>
                    {[true, false].map((met) => (
                      <label key={String(met)} className="option" style={{ marginBottom: 0, padding: '6px 10px' }}>
                        <input
                          type="radio"
                          name={`crit-${c.id}`}
                          checked={scores[c.id]?.met === met}
                          onChange={() => setScores((s) => ({ ...s, [c.id]: { note: s[c.id]?.note ?? '', met } }))}
                        />
                        <span className="small">{met ? 'Met' : 'Not met'}</span>
                      </label>
                    ))}
                  </div>
                  <input
                    aria-label={`Note for ${c.title}`}
                    placeholder="Note (optional)"
                    style={{ marginTop: 6 }}
                    value={scores[c.id]?.note ?? ''}
                    onChange={(e) => setScores((s) => ({ ...s, [c.id]: { met: s[c.id]?.met ?? null, note: e.target.value } }))}
                  />
                </fieldset>
              ))}
              <Field label="Comment to the learner" htmlFor="review-comment" hint="Required when asking for a revision.">
                <textarea id="review-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <div className="stack">
                <button
                  className="btn primary block"
                  disabled={!allScored || requiredUnmet.length > 0 || decide.isPending}
                  onClick={() => decide.mutate('approved')}
                >
                  Approve
                </button>
                <button
                  className="btn block"
                  disabled={!allScored || !comment.trim() || decide.isPending}
                  onClick={() => decide.mutate('revision_required')}
                >
                  Request revision
                </button>
              </div>
              {!allScored && <p className="tiny muted" style={{ marginTop: 8 }}>Score every criterion to decide.</p>}
              {requiredUnmet.length > 0 && <p className="tiny muted">Approval needs every required criterion met.</p>}
              {(decide.error || claim.error) && <ErrorNotice error={decide.error ?? claim.error} />}
            </div>
          )
        ) : (
          <div className="card">
            <h3>Decision</h3>
            {d.history
              .find((h) => h.id === d.submission.id)
              ?.reviews.map((r, i) => (
                <div key={i} className="small" style={{ marginBottom: 10 }}>
                  <strong>{r.decision === 'approved' ? 'Approved' : 'Revision requested'}</strong> by {r.reviewerName}
                  {r.viaAppeal ? ' on appeal' : ''} · {formatDate(r.createdAt)}
                  {r.comment && <p style={{ margin: '4px 0' }}>{r.comment}</p>}
                  <ul className="checklist">
                    {r.rubric.map((s) => (
                      <li key={s.criterionId}>
                        <span className={`tick ${s.met ? 'done' : ''}`} aria-hidden="true">
                          {s.met ? '✓' : '✕'}
                        </span>
                        {rubric.find((c) => c.id === s.criterionId)?.title ?? s.criterionId}
                        {s.note && <span className="muted"> · {s.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </aside>
    </div>
  );
}
