import { Link } from 'react-router-dom';
import { nextStep } from './nextStep';
import { formatDate, RewardBadge, rewardUnit, StageTimeline } from '../../components/ui';
import { usePlayer } from './Player';

export function LearnOverview() {
  const { view } = usePlayer();
  const next = nextStep(view);
  const base = `/learn/${view.course.id}`;
  const credential = view.completion?.credential;
  return (
    <div className="stack">
      {view.completion?.status === 'valid' ? (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <span className="badge ok">Completed {formatDate(view.completion.completedAt)}</span>
          <h1 style={{ marginTop: 10 }}>You finished {view.course.title}</h1>
          <p className="muted">Your completion was verified on the server{view.assignment?.required ? ' and approved by a reviewer' : ''}.</p>
          <div className="row">
            {credential && (
              <Link className="btn primary" to={`/verify/${credential.publicId}`}>
                View your credential
              </Link>
            )}
            {view.rewards.some((r) => r.status === 'eligible') && (
              <Link className="btn" to="/rewards">
                Claim your reward
              </Link>
            )}
          </div>
        </div>
      ) : view.completion?.status === 'revoked' ? (
        <div className="notice bad">
          <strong>This completion was revoked by the community.</strong>
          Contact the community owners if you believe this is a mistake.
        </div>
      ) : (
        <div className="card">
          <h1>{view.course.title}</h1>
          <StageTimeline stage={view.stage} />
          {next && (
            <div style={{ marginTop: 18 }}>
              <p className="muted small" style={{ marginBottom: 6 }}>
                Next step
              </p>
              <Link className="btn primary" to={`${base}${next.path}`}>
                {next.label}
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="grid two">
        <div className="card flat">
          <h3>To complete this course</h3>
          <ul className="checklist small">
            {view.requirements.map((r) => {
              const done =
                (r.startsWith('Finish every') && view.progress.lessonsDone >= view.progress.lessonsTotal) ||
                (r.startsWith('Score') && view.quiz?.passed) ||
                (r.startsWith('Have your') && view.assignment?.submissions[0]?.status === 'approved') ||
                view.completion?.status === 'valid';
              return (
                <li key={r}>
                  <span className={`tick ${done ? 'done' : ''}`} aria-hidden="true">
                    {done ? '✓' : ''}
                  </span>
                  <span>
                    {r}
                    <span className="sr-only">{done ? ' (done)' : ''}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
            {view.progress.lessonsDone} of {view.progress.lessonsTotal} required lessons done.
          </p>
        </div>
        <div className="card flat">
          <h3>Rewards</h3>
          {view.rewards.length === 0 ? (
            <p className="small muted">
              No reward is attached to your enrollment. Completing the course still earns {credential ? 'your' : 'a'} credential when
              the course issues one.
            </p>
          ) : (
            view.rewards.map((r) => (
              <div key={r.id} className="row between small" style={{ marginBottom: 8 }}>
                <span>
                  {rewardUnit(r.rewardKind, r.amount)} <span className="muted">· {r.campaignName}</span>
                </span>
                <RewardBadge status={r.status} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
