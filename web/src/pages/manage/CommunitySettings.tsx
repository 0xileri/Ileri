import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '../../api';
import { useAuth } from '../../auth';
import { PolicyEditor } from '../../components/PolicyEditor';
import { ErrorNotice, Field, useToast } from '../../components/ui';
import type { AccessRule } from '../../../../shared/src/access';
import type { CourseCard } from '../../types';
import { useManage } from './ManageRoutes';

export function CommunitySettings() {
  const { community, isOwner, refresh } = useManage();
  const { config } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: community.name,
    tagline: community.tagline,
    description: community.description,
    logoUrl: community.logoUrl ?? '',
    accentColor: community.accentColor,
    visibility: community.visibility,
  });
  const courses = useQuery({
    queryKey: ['community-courses', community.id, true],
    queryFn: () => get<{ courses: CourseCard[] }>(`/api/communities/${community.id}/courses?all=1`),
  });
  const saveProfile = useMutation({
    mutationFn: () => patch(`/api/communities/${community.id}`, form),
    onSuccess: async () => {
      toast('Community updated.');
      await refresh();
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const savePolicy = useMutation({
    mutationFn: (joinPolicy: AccessRule | null) => patch(`/api/communities/${community.id}`, { joinPolicy }),
    onSuccess: async () => {
      toast('Access rules saved. They apply to joining and to every protected page from now on.');
      await refresh();
    },
  });
  if (!isOwner) return <p className="muted">Only owners can change community settings.</p>;
  return (
    <div className="stack narrow">
      <section className="card">
        <h2>Who can join</h2>
        <p className="muted small">
          These rules are checked when someone joins and again whenever they open protected content. If someone stops meeting them,
          their access pauses but their progress and credentials are kept.
        </p>
        <PolicyEditor
          key={JSON.stringify(community.joinPolicy ?? null)}
          initial={community.joinPolicy ?? null}
          onSave={(rule) => savePolicy.mutate(rule)}
          saving={savePolicy.isPending}
          error={savePolicy.error}
          courses={(courses.data?.courses ?? []).map((c) => ({ id: c.id, title: c.title }))}
          chainIds={config?.supportedChainIds ?? [8453]}
          openLabel="Anyone with an account can join"
        />
      </section>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          saveProfile.mutate();
        }}
      >
        <h2>Profile and branding</h2>
        <Field label="Name" htmlFor="s-name">
          <input id="s-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Tagline" htmlFor="s-tagline">
          <input id="s-tagline" value={form.tagline} maxLength={160} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="s-desc" hint="Markdown is supported.">
          <textarea id="s-desc" rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Logo URL" htmlFor="s-logo" hint="A square image works best.">
            <input id="s-logo" type="url" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />
          </Field>
          <Field label="Accent colour" htmlFor="s-accent">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                id="s-accent"
                type="color"
                value={form.accentColor}
                onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                style={{ width: 52, height: 42, padding: 2, border: '1px solid var(--line-strong)', borderRadius: 8 }}
              />
              <input aria-label="Accent colour hex" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Visibility" htmlFor="s-vis">
            <select id="s-vis" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as 'public' | 'unlisted' })}>
              <option value="public">Listed in the directory</option>
              <option value="unlisted">Unlisted (link only)</option>
            </select>
          </Field>
        </div>
        <button className="btn primary" disabled={saveProfile.isPending}>
          Save profile
        </button>
        {saveProfile.error && <ErrorNotice error={saveProfile.error} />}
      </form>
    </div>
  );
}
