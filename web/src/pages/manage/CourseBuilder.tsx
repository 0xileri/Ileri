import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { courseContentSchema, publishIssues, type CourseContent } from '../../../../shared/src/content';
import type { AccessRule } from '../../../../shared/src/access';
import { ApiError, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { PolicyEditor } from '../../components/PolicyEditor';
import { ErrorNotice, Field, formatDate, Spinner, useToast } from '../../components/ui';
import type { CourseEditor } from '../../types';
import { AssignmentEditor, CompletionEditor, ModulesEditor, OverviewEditor, QuizEditor } from './CourseEditors';
import { useManage } from './ManageRoutes';

type Tab = 'details' | 'access' | 'lessons' | 'quiz' | 'assignment' | 'completion' | 'versions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'access', label: 'Access' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'completion', label: 'Completion' },
  { id: 'versions', label: 'Versions' },
];

export function CourseBuilder() {
  const { courseId = '' } = useParams();
  const { community, isOwner } = useManage();
  const { config } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('lessons');
  const query = useQuery({ queryKey: ['editor', courseId], queryFn: () => get<CourseEditor>(`/api/courses/${courseId}/editor`) });
  const [content, setContent] = useState<CourseContent | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!query.data || dirty) return;
    setContent(query.data.draft?.content ?? query.data.published?.content ?? null);
    setChangeNote(query.data.draft?.changeNote ?? '');
  }, [query.data, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const validation = useMemo(() => {
    if (!content) return { error: null as string | null, issues: [] as string[] };
    const parsed = courseContentSchema.safeParse(content);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return { error: i ? `${i.path.join(' › ')}: ${i.message}` : 'Invalid content', issues: [] };
    }
    return { error: null, issues: publishIssues(parsed.data) };
  }, [content]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['editor', courseId] });
  const saveDraft = useMutation({
    mutationFn: () => put<{ issues: string[] }>(`/api/courses/${courseId}/draft`, { content, changeNote }),
    onSuccess: async () => {
      setDirty(false);
      toast('Draft saved.');
      await invalidate();
    },
  });
  const startDraft = useMutation({
    mutationFn: () => post(`/api/courses/${courseId}/draft`),
    onSuccess: async () => {
      setDirty(false);
      await invalidate();
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await put(`/api/courses/${courseId}/draft`, { content, changeNote });
      return post<{ versionNumber: number }>(`/api/courses/${courseId}/publish`);
    },
    onSuccess: async (data) => {
      setDirty(false);
      toast(`Version ${data.versionNumber} is live.`);
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['community-courses'] })]);
    },
  });
  const savePolicy = useMutation({
    mutationFn: (accessPolicy: AccessRule | null) => patch(`/api/courses/${courseId}`, { accessPolicy }),
    onSuccess: async () => {
      toast('Access rules saved.');
      await invalidate();
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => post(`/api/courses/${courseId}/archive`, { archived }),
    onSuccess: invalidate,
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data!;
  const { course } = data;
  const editable = Boolean(data.draft);
  const change = (next: CourseContent) => {
    setContent(next);
    setDirty(true);
  };
  const publishError = publish.error instanceof ApiError ? publish.error : null;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <Link to={`/manage/${community.slug}/courses`} className="small">
            ← Courses
          </Link>
          <h1 style={{ margin: '4px 0 0' }}>{course.title}</h1>
          <div className="meta">
            <span className={`badge ${course.status === 'published' ? 'ok' : course.status === 'draft' ? 'warn' : ''}`}>{course.status}</span>
            {data.published && <span>Live: version {data.published.versionNumber}</span>}
            {data.draft && <span>Editing: version {data.draft.versionNumber} (draft)</span>}
          </div>
        </div>
        <div className="row">
          {course.status !== 'draft' && (
            <Link className="btn small" to={`/courses/${course.id}`}>
              View course page
            </Link>
          )}
          {isOwner && course.status === 'published' && (
            <button className="btn small ghost" onClick={() => confirm('Archive this course? Enrolled learners can finish, but nobody new can enroll.') && archive.mutate(true)}>
              Archive
            </button>
          )}
          {isOwner && course.status === 'archived' && (
            <button className="btn small" onClick={() => archive.mutate(false)}>
              Unarchive
            </button>
          )}
        </div>
      </div>

      {!editable && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <strong>Version {data.published?.versionNumber} is live and locked.</strong>
          Start a new draft to make changes. Learners already enrolled stay on the version they started, so edits never change what
          someone already completed.
          <div style={{ marginTop: 10 }}>
            <button className="btn small primary" onClick={() => startDraft.mutate()} disabled={startDraft.isPending}>
              Start a new draft
            </button>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="narrow stack">
          <CourseMetaForm editor={data} onSaved={invalidate} />
          {content && (
            <div className="card">
              <h3>Course page content</h3>
              <OverviewEditor content={content} onChange={change} disabled={!editable} />
            </div>
          )}
        </div>
      )}
      {tab === 'access' && (
        <div className="card narrow">
          <h2>Who can take this course</h2>
          <p className="small muted">
            Everyone must first be a member of {community.name}. Add conditions here for an extra gate, like a higher membership tier or
            finishing an earlier course.
          </p>
          <PolicyEditor
            key={JSON.stringify(course.accessPolicy)}
            initial={course.accessPolicy}
            onSave={(rule) => savePolicy.mutate(rule)}
            saving={savePolicy.isPending}
            error={savePolicy.error}
            courses={data.otherCourses}
            chainIds={data.supportedChainIds ?? config?.supportedChainIds ?? [8453]}
            openLabel={`All ${community.name} members`}
          />
        </div>
      )}
      {content && tab === 'lessons' && <ModulesEditor content={content} onChange={change} disabled={!editable} communityId={community.id} />}
      {content && tab === 'quiz' && <QuizEditor content={content} onChange={change} disabled={!editable} />}
      {content && tab === 'assignment' && <AssignmentEditor content={content} onChange={change} disabled={!editable} />}
      {content && tab === 'completion' && <CompletionEditor content={content} onChange={change} disabled={!editable} />}
      {tab === 'versions' && (
        <div className="stack">
          {editable && (
            <Field label="What changed in this draft" htmlFor="change-note" hint="Recorded in the version history and audit log.">
              <input
                id="change-note"
                value={changeNote}
                onChange={(e) => {
                  setChangeNote(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Published</th>
                  <th className="num">Learners on it</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.versionNumber}</td>
                    <td>
                      <span className={`badge ${v.status === 'published' ? 'ok' : v.status === 'draft' ? 'warn' : ''}`}>{v.status}</span>
                    </td>
                    <td className="small">{v.publishedAt ? formatDate(v.publishedAt, true) : '–'}</td>
                    <td className="num">{v.enrollmentCount}</td>
                    <td className="small">{v.changeNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editable && (
        <div className="sticky-actions">
          <div className="row between">
            <div className="small">
              {validation.error ? (
                <span style={{ color: 'var(--bad)' }}>{validation.error}</span>
              ) : validation.issues.length > 0 ? (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--warn)' }}>
                    {validation.issues.length} thing{validation.issues.length === 1 ? '' : 's'} to fix before publishing
                  </summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {validation.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </details>
              ) : (
                <span className="muted">{dirty ? 'Unsaved changes' : 'Draft saved. Ready to publish.'}</span>
              )}
            </div>
            <div className="row">
              <button className="btn" disabled={!dirty || Boolean(validation.error) || saveDraft.isPending} onClick={() => saveDraft.mutate()}>
                {saveDraft.isPending ? 'Saving…' : 'Save draft'}
              </button>
              <button
                className="btn primary"
                disabled={Boolean(validation.error) || validation.issues.length > 0 || publish.isPending}
                onClick={() =>
                  confirm(
                    data.published
                      ? `Publish version ${data.draft!.versionNumber}? New learners get it; current learners stay on their version.`
                      : 'Publish this course? Members who qualify will be able to enroll.',
                  ) && publish.mutate()
                }
              >
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
          {saveDraft.error && <ErrorNotice error={saveDraft.error} />}
          {publishError && <ErrorNotice error={publishError} />}
        </div>
      )}
    </div>
  );
}

function CourseMetaForm({ editor, onSaved }: { editor: CourseEditor; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const { course } = editor;
  const [form, setForm] = useState({
    title: course.title,
    summary: course.summary,
    slug: course.slug,
    coverUrl: course.coverUrl ?? '',
    creditCost: course.creditCost,
  });
  const save = useMutation({
    mutationFn: () => patch(`/api/courses/${course.id}`, form),
    onSuccess: async () => {
      toast('Course details saved.');
      await onSaved();
    },
  });
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3>Course details</h3>
      <p className="small muted">These save immediately and aren't versioned.</p>
      <Field label="Title" htmlFor="cm-title">
        <input id="cm-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Summary" htmlFor="cm-summary" hint="One or two sentences for catalog cards.">
        <textarea id="cm-summary" rows={2} style={{ minHeight: 70 }} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Address" htmlFor="cm-slug">
          <input id="cm-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Course credits to enroll" htmlFor="cm-credits" hint="0 for free. Staff enroll free.">
          <input id="cm-credits" type="number" min={0} value={form.creditCost} onChange={(e) => setForm({ ...form, creditCost: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Cover image URL (optional)" htmlFor="cm-cover">
        <input id="cm-cover" type="url" value={form.coverUrl} onChange={(e) => setForm({ ...form, coverUrl: e.target.value })} />
      </Field>
      <button className="btn primary" disabled={save.isPending}>
        Save details
      </button>
      {save.error && <ErrorNotice error={save.error} />}
    </form>
  );
}
