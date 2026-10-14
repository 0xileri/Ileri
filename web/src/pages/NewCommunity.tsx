import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { post } from '../api';
import { useAuth } from '../auth';
import { ErrorNotice, Field, usePageTitle } from '../components/ui';

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function NewCommunityPage() {
  usePageTitle('Start a community');
  const { config, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => post<{ community: { slug: string } }>('/api/communities', { name, slug: slug || undefined, tagline, description }),
    onSuccess: async (data) => {
      await qc.invalidateQueries();
      navigate(`/manage/${data.community.slug}/settings`);
    },
  });
  if (config?.communityCreation === 'admin' && !user?.isPlatformAdmin) {
    return (
      <div className="container narrow page">
        <h1>Start a community</h1>
        <p className="notice">New communities are set up by the platform team. Get in touch and we'll help you get started.</p>
      </div>
    );
  }
  return (
    <div className="container narrow page">
      <h1>Start a community</h1>
      <p className="muted">You'll be the owner. Next you can set who can join, invite instructors and create your first course.</p>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Name" htmlFor="c-name">
          <input
            id="c-name"
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Address" htmlFor="c-slug" hint={`${window.location.host}/c/${slug || 'your-community'}`}>
          <input
            id="c-slug"
            value={slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label="Tagline" htmlFor="c-tagline" hint="One line shown in the directory.">
          <input id="c-tagline" maxLength={160} value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="c-desc" hint="Markdown is supported.">
          <textarea id="c-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button className="btn primary" disabled={create.isPending || name.trim().length < 2}>
          {create.isPending ? 'Creating…' : 'Create community'}
        </button>
        {create.error && <ErrorNotice error={create.error} />}
      </form>
    </div>
  );
}
