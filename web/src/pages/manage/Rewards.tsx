import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../../api';
import { campaignText, Empty, ErrorNotice, Field, formatDate, ProgressBar, rewardUnit, Spinner, useToast } from '../../components/ui';
import type { CampaignSummary, CourseCard } from '../../types';
import { useManage } from './ManageRoutes';

interface CampaignAdmin extends CampaignSummary {
  courseTitle: string;
  totalBudget: number | null;
  allocatedCount: number;
  allocatedAmount: number;
  paidAmount: number;
  counts: Record<string, { count: number; amount: number }>;
  createdAt: string;
}

interface Claim {
  id: string;
  status: string;
  amount: number;
  claimedAt: string | null;
  learnerName: string;
  learnerId: string;
  campaignName: string;
  rewardKind: 'points' | 'course_credits';
  courseTitle: string;
}

export function RewardsAdmin() {
  const { community, isOwner } = useManage();
  const qc = useQueryClient();
  const toast = useToast();
  const campaigns = useQuery({
    queryKey: ['campaigns', community.id],
    queryFn: () => get<{ campaigns: CampaignAdmin[] }>(`/api/communities/${community.id}/campaigns`),
  });
  const claims = useQuery({
    queryKey: ['claims', community.id, 'submitted'],
    enabled: isOwner,
    queryFn: () => get<{ claims: Claim[] }>(`/api/communities/${community.id}/reward-claims`),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => post(`/api/campaigns/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', community.id] }),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note: string }) =>
      post(`/api/reward-claims/${id}/decision`, { decision, note }),
    onSuccess: () => {
      toast('Claim updated.');
      qc.invalidateQueries();
    },
  });
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="stack">
      <p className="muted">
        Rewards are paid from budgets you set. They're kept separate from any platform fees, and learners see the terms before they
        enroll.
      </p>

      {isOwner && (claims.data?.claims.length ?? 0) > 0 && (
        <section className="card">
          <h3>Claims waiting for approval</h3>
          {claims.data!.claims.map((c) => (
            <div key={c.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                <strong>{c.learnerName}</strong> · {rewardUnit(c.rewardKind, c.amount)} · {c.courseTitle}
                <span className="tiny muted"> · claimed {formatDate(c.claimedAt)}</span>
              </span>
              <span className="row">
                <button className="btn small primary" onClick={() => decide.mutate({ id: c.id, decision: 'approve', note: '' })}>
                  Approve
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    const note = prompt('Reason for rejecting (shown to the learner)');
                    if (note?.trim()) decide.mutate({ id: c.id, decision: 'reject', note: note.trim() });
                  }}
                >
                  Reject
                </button>
              </span>
            </div>
          ))}
          {decide.error && <ErrorNotice error={decide.error} />}
        </section>
      )}

      <div className="row between">
        <h2 style={{ margin: 0 }}>Campaigns</h2>
        {isOwner && (
          <button className="btn primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'New campaign'}
          </button>
        )}
      </div>
      {showForm && <CampaignForm onDone={() => setShowForm(false)} />}
      {campaigns.isLoading && <Spinner />}
      {campaigns.error && <ErrorNotice error={campaigns.error} />}
      {setStatus.error && <ErrorNotice error={setStatus.error} />}
      {campaigns.data && campaigns.data.campaigns.length === 0 && <Empty>No reward campaigns yet.</Empty>}
      {campaigns.data?.campaigns.map((c) => {
        const cap = c.maxRewards ?? (c.totalBudget ? Math.floor(c.totalBudget / c.amountPerCompletion) : null);
        return (
          <div key={c.id} className="card flat">
            <div className="row between">
              <div>
                <h3 style={{ margin: 0 }}>{c.name}</h3>
                <div className="small muted">{c.courseTitle}</div>
              </div>
              <span className={`badge ${c.status === 'active' ? (c.live ? 'ok' : 'warn') : c.status === 'paused' ? 'warn' : ''}`}>
                {c.status === 'active' && !c.live ? 'scheduled' : c.status}
              </span>
            </div>
            <p className="small" style={{ marginTop: 8 }}>{campaignText(c)}</p>
            {cap !== null && (
              <div style={{ maxWidth: 420 }}>
                <ProgressBar value={(c.allocatedCount / cap) * 100} label="Budget used" />
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {c.allocatedCount} of {cap} rewards committed · {rewardUnit(c.rewardKind, c.paidAmount)} paid
                  {c.totalBudget ? ` · budget ${c.totalBudget}` : ''}
                </div>
              </div>
            )}
            <div className="meta" style={{ marginTop: 8 }}>
              {Object.entries(c.counts).map(([status, v]) => (
                <span key={status}>
                  {status}: {v.count}
                </span>
              ))}
            </div>
            {isOwner && c.status !== 'ended' && (
              <div className="row" style={{ marginTop: 12 }}>
                {c.status !== 'active' && (
                  <button className="btn small primary" onClick={() => setStatus.mutate({ id: c.id, status: 'active' })}>
                    Activate
                  </button>
                )}
                {c.status === 'active' && (
                  <button className="btn small" onClick={() => setStatus.mutate({ id: c.id, status: 'paused' })}>
                    Pause
                  </button>
                )}
                <EditCap campaign={c} />
                <button
                  className="btn small danger"
                  onClick={() => confirm('End this campaign? Unfinished reservations are released. This cannot be undone.') && setStatus.mutate({ id: c.id, status: 'ended' })}
                >
                  End
                </button>
              </div>
            )}
          </div>
        );
      })}
      {isOwner && <LedgerAdjustment />}
    </div>
  );
}

function EditCap({ campaign }: { campaign: CampaignAdmin }) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (maxRewards: number | null) => patch(`/api/campaigns/${campaign.id}`, { maxRewards }),
    onSuccess: () => {
      toast('Cap updated.');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not update cap', 'bad'),
  });
  return (
    <button
      className="btn small"
      onClick={() => {
        const value = prompt('Maximum number of rewarded completions (blank for no cap)', campaign.maxRewards?.toString() ?? '');
        if (value === null) return;
        save.mutate(value.trim() ? Number(value) : null);
      }}
    >
      Change cap
    </button>
  );
}

function CampaignForm({ onDone }: { onDone: () => void }) {
  const { community } = useManage();
  const qc = useQueryClient();
  const courses = useQuery({
    queryKey: ['community-courses', community.id, true],
    queryFn: () => get<{ courses: CourseCard[] }>(`/api/communities/${community.id}/courses?all=1`),
  });
  const [form, setForm] = useState({
    courseId: '',
    name: '',
    rewardKind: 'points' as 'points' | 'course_credits',
    amountPerCompletion: 10,
    maxRewards: '100',
    totalBudget: '',
    allocationMode: 'first_approved' as 'first_approved' | 'reserved_at_enrollment',
    requiresApproval: false,
    endsAt: '',
    claimDeadline: '',
    activate: true,
  });
  const create = useMutation({
    mutationFn: () =>
      post(`/api/communities/${community.id}/campaigns`, {
        ...form,
        courseId: form.courseId || courses.data?.courses[0]?.id,
        maxRewards: form.maxRewards ? Number(form.maxRewards) : null,
        totalBudget: form.totalBudget ? Number(form.totalBudget) : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        claimDeadline: form.claimDeadline ? new Date(form.claimDeadline).toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', community.id] });
      onDone();
    },
  });
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h3>New reward campaign</h3>
      <div className="form-grid">
        <Field label="Course" htmlFor="cf-course">
          <select id="cf-course" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
            {(courses.data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Campaign name" htmlFor="cf-name" hint="Learners see this.">
          <input id="cf-name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Reward" htmlFor="cf-kind">
          <select id="cf-kind" value={form.rewardKind} onChange={(e) => setForm({ ...form, rewardKind: e.target.value as 'points' | 'course_credits' })}>
            <option value="points">Points (recognition)</option>
            <option value="course_credits">Course credits (spend on other courses)</option>
          </select>
        </Field>
        <Field label="Amount per completion" htmlFor="cf-amount">
          <input id="cf-amount" type="number" min={1} value={form.amountPerCompletion} onChange={(e) => setForm({ ...form, amountPerCompletion: Number(e.target.value) })} />
        </Field>
        <Field label="Max rewarded completions" htmlFor="cf-max" hint="Leave blank for no cap.">
          <input id="cf-max" type="number" min={1} value={form.maxRewards} onChange={(e) => setForm({ ...form, maxRewards: e.target.value })} />
        </Field>
        <Field label="Total budget (optional)" htmlFor="cf-budget" hint="Whichever limit is hit first applies.">
          <input id="cf-budget" type="number" min={1} value={form.totalBudget} onChange={(e) => setForm({ ...form, totalBudget: e.target.value })} />
        </Field>
      </div>
      <fieldset>
        <legend>Who gets the reward</legend>
        <label className="option">
          <input type="radio" name="mode" checked={form.allocationMode === 'first_approved'} onChange={() => setForm({ ...form, allocationMode: 'first_approved' })} />
          <span>
            <strong>First approved completions</strong>
            <span className="small muted" style={{ display: 'block' }}>
              Paid to the first learners whose completion is approved, until the budget runs out. Learners see how many are left before
              they enroll.
            </span>
          </span>
        </label>
        <label className="option">
          <input type="radio" name="mode" checked={form.allocationMode === 'reserved_at_enrollment'} onChange={() => setForm({ ...form, allocationMode: 'reserved_at_enrollment' })} />
          <span>
            <strong>Guaranteed at enrollment</strong>
            <span className="small muted" style={{ display: 'block' }}>
              Budget is reserved when someone enrolls, so the reward is theirs if they finish. Unused reservations are released when the
              campaign ends. Needs a cap.
            </span>
          </span>
        </label>
      </fieldset>
      <div className="form-grid">
        <Field label="Ends (optional)" htmlFor="cf-ends">
          <input id="cf-ends" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </Field>
        <Field label="Claim deadline (optional)" htmlFor="cf-deadline">
          <input id="cf-deadline" type="datetime-local" value={form.claimDeadline} onChange={(e) => setForm({ ...form, claimDeadline: e.target.value })} />
        </Field>
      </div>
      <label className="check" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} />
        <span>
          Review each claim before paying
          <span className="small muted" style={{ display: 'block' }}>Recommended for higher-value rewards, where repeat accounts are a risk.</span>
        </span>
      </label>
      <label className="check" style={{ marginBottom: 16 }}>
        <input type="checkbox" checked={form.activate} onChange={(e) => setForm({ ...form, activate: e.target.checked })} />
        Start now
      </label>
      <button className="btn primary" disabled={create.isPending}>
        Create campaign
      </button>
      {create.error && <ErrorNotice error={create.error} />}
    </form>
  );
}

function LedgerAdjustment() {
  const { community } = useManage();
  const toast = useToast();
  const members = useQuery({
    queryKey: ['members', community.id],
    queryFn: () => get<{ members: { userId: string; displayName: string }[] }>(`/api/communities/${community.id}/members`),
  });
  const [form, setForm] = useState({ userId: '', kind: 'points', amount: 0, memo: '' });
  const save = useMutation({
    mutationFn: () => post(`/api/communities/${community.id}/ledger-adjustments`, { ...form, userId: form.userId || members.data?.members[0]?.userId }),
    onSuccess: () => {
      toast('Balance adjusted.');
      setForm({ ...form, amount: 0, memo: '' });
    },
  });
  return (
    <details className="editor-block">
      <summary>Manual balance adjustment</summary>
      <form
        className="editor-body"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="small muted">For corrections and goodwill grants. Every adjustment is recorded in the audit log with your note.</p>
        <div className="form-grid">
          <Field label="Member" htmlFor="adj-user">
            <select id="adj-user" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              {(members.data?.members ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Balance" htmlFor="adj-kind">
            <select id="adj-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="points">Points</option>
              <option value="course_credits">Course credits</option>
            </select>
          </Field>
          <Field label="Amount" htmlFor="adj-amount" hint="Negative to deduct.">
            <input id="adj-amount" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Note" htmlFor="adj-memo">
          <input id="adj-memo" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
        </Field>
        <button className="btn" disabled={save.isPending || !form.amount || form.memo.trim().length < 3}>
          Apply adjustment
        </button>
        {save.error && <ErrorNotice error={save.error} />}
      </form>
    </details>
  );
}
