import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { post, upload } from '../../api';
import { ErrorNotice, Field, formatDate, Markdown, SubmissionBadge, useToast } from '../../components/ui';
import type { SubmissionRecord } from '../../types';
import { usePlayer } from './Player';

export function AssignmentPage() {
  const { view, refresh } = usePlayer();
  const toast = useToast();
  const assignment = view.assignment;
  const [text, setText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const submit = useMutation({
    mutationFn: async () => {
      let mediaId: string | null = null;
      if (file) {
        const res = await upload<{ media: { id: string } }>(`/api/courses/${view.course.id}/uploads`, file);
        mediaId = res.media.id;
      }
      return post(`/api/courses/${view.course.id}/submissions`, { text, linkUrl: linkUrl || null, mediaId });
    },
    onSuccess: async () => {
      setText('');
      setLinkUrl('');
      setFile(null);
      toast('Submitted. A reviewer will look at it soon.');
      await refresh();
    },
  });

  if (!assignment) return <p>This course has no assignment.</p>;
  const latest = assignment.submissions[0];
  const canSubmit = view.access.state === 'granted' && (!latest || latest.status === 'revision_required');

  return (
    <div className="stack">
      <div className="card">
        <h1>{assignment.title}</h1>
        {assignment.prompt ? <Markdown source={assignment.prompt} /> : <p className="muted">Instructions are hidden while your access is paused.</p>}
        <h3 style={{ marginTop: 20 }}>How it's assessed</h3>
        <ul className="checklist small">
          {assignment.rubric.map((c) => (
            <li key={c.id}>
              <span className="tick" aria-hidden="true" />
              <span>
                <strong>{c.title}</strong>
                {!c.required && <span className="muted"> (optional)</span>}
                {c.description && <span className="muted"> · {c.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {latest?.status === 'approved' && <p className="notice ok">Your assignment was approved.</p>}
      {(latest?.status === 'submitted' || latest?.status === 'under_review') && (
        <p className="notice info">
          {latest.status === 'submitted' ? 'Submitted and waiting for a reviewer.' : 'A reviewer is looking at your work now.'} You'll see
          the decision here.
        </p>
      )}

      {canSubmit && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <h2>{latest ? 'Submit a revision' : 'Submit your work'}</h2>
          <Field label="Written response" htmlFor="sub-text" hint="Plain text or Markdown.">
            <textarea id="sub-text" value={text} onChange={(e) => setText(e.target.value)} rows={10} />
          </Field>
          {assignment.allowLink && (
            <Field label="Link (optional)" htmlFor="sub-link" hint="A document, repository or video. Make sure reviewers can open it.">
              <input id="sub-link" type="url" placeholder="https://" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
            </Field>
          )}
          {assignment.allowFile && (
            <Field label="File (optional)" htmlFor="sub-file" hint="PDF, image, text, zip or short video, up to 25 MB.">
              <input id="sub-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
          )}
          <div className="row end">
            <button className="btn primary" type="submit" disabled={submit.isPending || (!text.trim() && !linkUrl && !file)}>
              {submit.isPending ? 'Submitting…' : 'Submit for review'}
            </button>
          </div>
          {submit.error && <ErrorNotice error={submit.error} />}
        </form>
      )}

      {assignment.submissions.length > 0 && (
        <section>
          <h2>Your submissions</h2>
          {assignment.submissions.map((s, i) => (
            <SubmissionCard key={s.id} submission={s} rubric={assignment.rubric} isLatest={i === 0} onChange={refresh} />
          ))}
        </section>
      )}
    </div>
  );
}

function SubmissionCard({
  submission,
  rubric,
  isLatest,
  onChange,
}: {
  submission: SubmissionRecord;
  rubric: { id: string; title: string }[];
  isLatest: boolean;
  onChange: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [appealing, setAppealing] = useState(false);
  const appeal = useMutation({
    mutationFn: () => post(`/api/submissions/${submission.id}/appeal`, { reason }),
    onSuccess: async () => {
      setAppealing(false);
      await onChange();
    },
  });
  return (
    <div className="card flat" style={{ marginBottom: 12 }}>
      <div className="row between">
        <strong>Attempt {submission.attemptNumber}</strong>
        <SubmissionBadge status={submission.status} />
      </div>
      <p className="tiny muted">Submitted {formatDate(submission.createdAt, true)}</p>
      {submission.text && (
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>
            Your response
          </summary>
          <Markdown source={submission.text} className="prose small" />
        </details>
      )}
      {submission.linkUrl && (
        <p className="small">
          Link:{' '}
          <a href={submission.linkUrl} target="_blank" rel="noreferrer noopener">
            {submission.linkUrl}
          </a>
        </p>
      )}
      {submission.file && (
        <p className="small">
          <a href={submission.file.url} target="_blank" rel="noreferrer">
            Attached file
          </a>
        </p>
      )}
      {submission.reviews.map((r, i) => (
        <div key={i} className={`notice ${r.decision === 'approved' ? 'ok' : 'warn'}`} style={{ marginTop: 10 }}>
          <strong>
            {r.decision === 'approved' ? 'Approved' : 'Revision requested'}
            {r.viaAppeal ? ' on appeal' : ''} · {formatDate(r.createdAt)}
          </strong>
          {r.comment && <p style={{ margin: '4px 0' }}>{r.comment}</p>}
          <ul className="checklist small">
            {r.rubric.map((score) => (
              <li key={score.criterionId}>
                <span className={`tick ${score.met ? 'done' : ''}`} aria-hidden="true">
                  {score.met ? '✓' : '✕'}
                </span>
                <span>
                  {rubric.find((c) => c.id === score.criterionId)?.title ?? score.criterionId}
                  <span className="sr-only">{score.met ? ' met' : ' not met'}</span>
                  {score.note && <span className="muted"> · {score.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {submission.appeal && (
        <div className="notice info small" style={{ marginTop: 10 }}>
          <strong>
            Appeal {submission.appeal.status === 'open' ? 'under consideration' : submission.appeal.status === 'overturned' ? 'accepted' : 'declined'}
          </strong>
          {submission.appeal.resolutionNote && <span>{submission.appeal.resolutionNote}</span>}
        </div>
      )}
      {isLatest && submission.status === 'revision_required' && !submission.appeal && (
        <div style={{ marginTop: 10 }}>
          {appealing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                appeal.mutate();
              }}
            >
              <Field label="Why should this decision be reconsidered?" htmlFor={`appeal-${submission.id}`} hint="A community owner who didn't review your work will decide.">
                <textarea id={`appeal-${submission.id}`} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="row">
                <button className="btn" type="submit" disabled={appeal.isPending || reason.trim().length < 20}>
                  Send appeal
                </button>
                <button className="btn ghost" type="button" onClick={() => setAppealing(false)}>
                  Cancel
                </button>
              </div>
              {appeal.error && <ErrorNotice error={appeal.error} />}
            </form>
          ) : (
            <button className="link-button small" onClick={() => setAppealing(true)}>
              Disagree with this decision? Appeal it
            </button>
          )}
        </div>
      )}
    </div>
  );
}
