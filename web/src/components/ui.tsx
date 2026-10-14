import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { RuleResult } from '../../../shared/src/access';
import { errorMessage } from '../api';
import type { CampaignSummary, Requirements, Stage } from '../types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="spinner" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice bad" role="alert">
      <div className="row between">
        <span>{errorMessage(error)}</span>
        {onRetry && (
          <button className="btn small" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Ileri` : 'Ileri';
  }, [title]);
}

export function Markdown({ source, className = 'prose' }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(source ?? '', { async: false, gfm: true, breaks: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [source]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={label ?? 'Progress'}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function CommunityLogo({ name, logoUrl, small }: { name: string; logoUrl?: string | null; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`logo${small ? ' small' : ''}`} aria-hidden="true">
      {logoUrl && !broken ? <img src={logoUrl} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <div className="avatar" aria-hidden="true">
      {initials(name)}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = Number.parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.4 ? '#161512' : '#ffffff';
}

/** Applies a community's brand colour. The stylesheet adapts it for dark mode. */
export function brandProps(color?: string | null): { style?: CSSProperties; 'data-brand'?: '' } {
  if (!color) return {};
  return { style: { '--brand': color, '--brand-ink': inkFor(color), '--card-accent': color } as CSSProperties, 'data-brand': '' };
}

// --- Formatting --------------------------------------------------------------

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function timeAgo(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const minutes = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function rewardUnit(kind: 'points' | 'course_credits', amount: number): string {
  if (kind === 'points') return `${amount} ${amount === 1 ? 'point' : 'points'}`;
  return `${amount} course ${amount === 1 ? 'credit' : 'credits'}`;
}

// --- Status badges -------------------------------------------------------------

const STAGES: Record<Stage, { label: string; tone: string }> = {
  enrolled: { label: 'Enrolled', tone: '' },
  learning: { label: 'Learning', tone: 'info' },
  submitted: { label: 'Submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'warn' },
  revision_required: { label: 'Revision required', tone: 'bad' },
  approved: { label: 'Approved', tone: 'ok' },
  completed: { label: 'Completed', tone: 'ok' },
};

export function StageBadge({ stage }: { stage: Stage }) {
  const s = STAGES[stage];
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

export const STAGE_ORDER: Stage[] = ['enrolled', 'learning', 'submitted', 'under_review', 'completed'];

export function StageTimeline({ stage }: { stage: Stage }) {
  const order: Stage[] = ['enrolled', 'learning', 'submitted', 'under_review', stage === 'revision_required' ? 'revision_required' : 'approved', 'completed'];
  const index = order.indexOf(stage === 'approved' ? 'approved' : stage);
  return (
    <ol className="timeline" aria-label="Progress stages">
      {order.map((s, i) => (
        <li key={s} className={i === index ? 'current' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined}>
          {STAGES[s].label}
        </li>
      ))}
    </ol>
  );
}

const SUBMISSION_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'Submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  revision_required: { label: 'Revision required', tone: 'bad' },
};

export function SubmissionBadge({ status }: { status: string }) {
  const s = SUBMISSION_STATUS[status] ?? { label: status, tone: '' };
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

const REWARD_STATUS: Record<string, { label: string; tone: string; help: string }> = {
  reserved: { label: 'Reserved', tone: 'info', help: 'Held for you. Complete the course to claim it.' },
  eligible: { label: 'Ready to claim', tone: 'ok', help: 'You earned this. Claim it to add it to your balance.' },
  submitted: { label: 'Awaiting approval', tone: 'warn', help: 'The community reviews claims for this campaign before paying.' },
  pending: { label: 'Processing', tone: 'warn', help: 'Your payout is being processed.' },
  confirmed: { label: 'Paid', tone: 'ok', help: 'Added to your balance.' },
  failed: { label: 'Failed', tone: 'bad', help: 'The payout failed. You can try claiming again.' },
  rejected: { label: 'Rejected', tone: 'bad', help: 'The community declined this claim.' },
  expired: { label: 'Expired', tone: '', help: 'This reward is no longer available.' },
  unfunded: { label: 'Budget used up', tone: '', help: 'The campaign ran out of budget before your completion was approved.' },
};

export function RewardBadge({ status }: { status: string }) {
  const s = REWARD_STATUS[status] ?? { label: status, tone: '' };
  return (
    <span className={`badge ${s.tone}`} title={REWARD_STATUS[status]?.help}>
      {s.label}
    </span>
  );
}

export function rewardHelp(status: string): string {
  return REWARD_STATUS[status]?.help ?? '';
}

/** e.g. "20 points. For the first 100 learners whose completion is approved. 37 left." */
export function campaignText(c: CampaignSummary): string {
  const reward = rewardUnit(c.rewardKind, c.amountPerCompletion);
  const who =
    c.allocationMode === 'reserved_at_enrollment'
      ? c.maxRewards
        ? `Reserved for the first ${c.maxRewards} learners to enroll, paid on completion`
        : 'Reserved when you enroll, paid on completion'
      : c.maxRewards
        ? `For the first ${c.maxRewards} learners whose completion is approved`
        : 'For every learner whose completion is approved';
  const parts = [`${reward}. ${who}.`];
  if (c.remaining !== null) parts.push(c.remaining === 0 ? 'Budget used up.' : `${c.remaining} left.`);
  if (c.requiresApproval) parts.push('Claims are reviewed before payout.');
  if (c.endsAt) parts.push(`Ends ${formatDate(c.endsAt)}.`);
  return parts.join(' ');
}

// --- Access requirements -------------------------------------------------------

export function RuleTree({ result, evaluated = true }: { result: RuleResult; evaluated?: boolean }) {
  return (
    <ul className="rule-tree">
      <RuleNode node={result} evaluated={evaluated} />
    </ul>
  );
}

function RuleNode({ node, evaluated }: { node: RuleResult; evaluated: boolean }) {
  const icon = !evaluated ? '•' : node.state === 'eligible' ? '✓' : node.state === 'ineligible' ? '✕' : '?';
  const label = !evaluated ? '' : node.state === 'eligible' ? 'Met: ' : node.state === 'ineligible' ? 'Not met: ' : 'Could not check: ';
  return (
    <li>
      <span className={`rule-icon ${evaluated ? node.state : 'unknown'}`} aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="sr-only">{label}</span>
        {node.text}
      </span>
      {node.children && (
        <ul>
          {node.children.map((child, i) => (
            <RuleNode key={i} node={child} evaluated={evaluated} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function RequirementsPanel({ requirements, title = 'Who can access this' }: { requirements: Requirements; title?: string }) {
  if (requirements.state === 'open') {
    return <p className="muted small">{requirements.summary}.</p>;
  }
  return (
    <div>
      <h4>{title}</h4>
      {requirements.result ? <RuleTree result={requirements.result} evaluated={requirements.evaluated} /> : <p>{requirements.summary}</p>}
      {requirements.evaluated && requirements.state === 'unknown' && (
        <p className="notice warn small" style={{ marginTop: 10 }}>
          We couldn't check token holdings right now. This is usually temporary. Please try again shortly.
        </p>
      )}
    </div>
  );
}

// --- Dialog ----------------------------------------------------------------------

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="dialog-title">
      <div className="dialog-body">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 id="dialog-title" style={{ margin: 0 }}>
            {title}
          </h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

// --- Toasts ----------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'bad';
}

const ToastContext = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'bad' ? 'bad' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="card tight flat stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/** Turns YouTube/Vimeo links into embeds; plays direct files with <video>. */
export function VideoEmbed({ url, mimeType }: { url: string; mimeType?: string }) {
  const embed = toEmbedUrl(url);
  if (embed) {
    return (
      <div className="video">
        <iframe src={embed} title="Lesson video" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
      </div>
    );
  }
  return (
    <div className="video">
      <video controls preload="metadata" controlsList="nodownload">
        <source src={url} type={mimeType} />
      </video>
    </div>
  );
}

export function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin);
    if (u.hostname.endsWith('youtube.com') && u.searchParams.get('v')) {
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get('v')!)}`;
    }
    if (u.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (u.hostname.endsWith('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return null;
  }
  return null;
}
