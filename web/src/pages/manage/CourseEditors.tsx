import { useState } from 'react';
import { newId, type CourseContent, type Lesson } from '../../../../shared/src/content';
import { errorMessage, upload } from '../../api';
import { Field, Markdown, useToast } from '../../components/ui';

export interface EditorProps {
  content: CourseContent;
  onChange: (next: CourseContent) => void;
  disabled: boolean;
}

function useEdit({ content, onChange }: EditorProps) {
  return (fn: (draft: CourseContent) => void) => {
    const next = structuredClone(content);
    fn(next);
    onChange(next);
  };
}

function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target]!, list[index]!];
}

export function OverviewEditor(props: EditorProps) {
  const { content, disabled } = props;
  const edit = useEdit(props);
  return (
    <fieldset disabled={disabled}>
      <Field label="Description" htmlFor="ce-desc" hint="Shown on the course page. Markdown is supported.">
        <textarea id="ce-desc" rows={6} value={content.description} onChange={(e) => edit((d) => void (d.description = e.target.value))} />
      </Field>
      <Field label="Learning outcomes" htmlFor="ce-outcomes" hint="One per line. Start each with a verb: Explain, Build, Recognise…">
        <textarea
          id="ce-outcomes"
          rows={4}
          value={content.outcomes.join('\n')}
          onChange={(e) => edit((d) => void (d.outcomes = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)))}
        />
      </Field>
      <div className="form-grid">
        <Field label="Instructor name" htmlFor="ce-instructor">
          <input id="ce-instructor" value={content.instructorName} onChange={(e) => edit((d) => void (d.instructorName = e.target.value))} />
        </Field>
        <Field label="Prerequisites (description)" htmlFor="ce-prereq" hint="Plain text. Enforced prerequisites live under Access.">
          <input id="ce-prereq" value={content.prerequisitesText} onChange={(e) => edit((d) => void (d.prerequisitesText = e.target.value))} />
        </Field>
      </div>
    </fieldset>
  );
}

export function ModulesEditor(props: EditorProps & { communityId: string }) {
  const { content, disabled, communityId } = props;
  const edit = useEdit(props);
  return (
    <fieldset disabled={disabled}>
      {content.modules.map((m, mi) => (
        <div key={m.id} className="editor-block">
          <div className="editor-head">
            <input
              aria-label={`Module ${mi + 1} title`}
              value={m.title}
              onChange={(e) => edit((d) => void (d.modules[mi]!.title = e.target.value))}
              style={{ fontWeight: 600 }}
            />
            <button type="button" className="btn small ghost" aria-label="Move module up" onClick={() => edit((d) => move(d.modules, mi, -1))}>
              ↑
            </button>
            <button type="button" className="btn small ghost" aria-label="Move module down" onClick={() => edit((d) => move(d.modules, mi, 1))}>
              ↓
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => (m.lessons.length === 0 || confirm(`Delete "${m.title}" and its lessons?`)) && edit((d) => void d.modules.splice(mi, 1))}
            >
              Delete
            </button>
          </div>
          <div className="editor-body">
            {m.lessons.map((l, li) => (
              <LessonEditor
                key={l.id}
                lesson={l}
                communityId={communityId}
                disabled={disabled}
                onChange={(lesson) => edit((d) => void (d.modules[mi]!.lessons[li] = lesson))}
                onMove={(delta) => edit((d) => move(d.modules[mi]!.lessons, li, delta))}
                onDelete={() => confirm(`Delete lesson "${l.title}"?`) && edit((d) => void d.modules[mi]!.lessons.splice(li, 1))}
              />
            ))}
            <button
              type="button"
              className="btn small"
              onClick={() =>
                edit((d) =>
                  void d.modules[mi]!.lessons.push({
                    id: newId('les'),
                    title: 'New lesson',
                    kind: 'text',
                    body: '',
                    videoUrl: '',
                    mediaId: null,
                    attachments: [],
                    estimatedMinutes: 10,
                    required: true,
                  }),
                )
              }
            >
              Add lesson
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => edit((d) => void d.modules.push({ id: newId('mod'), title: 'New module', lessons: [] }))}>
        Add module
      </button>
    </fieldset>
  );
}

function LessonEditor({
  lesson,
  communityId,
  disabled,
  onChange,
  onMove,
  onDelete,
}: {
  lesson: Lesson;
  communityId: string;
  disabled: boolean;
  onChange: (l: Lesson) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<Lesson>) => onChange({ ...lesson, ...patch });
  async function uploadFile(file: File, as: 'video' | 'attachment') {
    setUploading(true);
    try {
      const { media } = await upload<{ media: { id: string; filename: string } }>(`/api/communities/${communityId}/media`, file);
      if (as === 'video') set({ mediaId: media.id, kind: 'video' });
      else set({ attachments: [...lesson.attachments, { mediaId: media.id, name: media.filename }] });
      toast(`Uploaded ${media.filename}`);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setUploading(false);
    }
  }
  return (
    <details className="editor-block" style={{ marginBottom: 10 }}>
      <summary>
        <span className="tiny muted">{lesson.kind === 'video' ? 'Video' : 'Reading'}</span>
        <span className="spacer">{lesson.title || 'Untitled lesson'}</span>
        {!lesson.required && <span className="badge">optional</span>}
      </summary>
      <div className="editor-body">
        <div className="form-grid">
          <Field label="Title" htmlFor={`lt-${lesson.id}`}>
            <input id={`lt-${lesson.id}`} value={lesson.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Type" htmlFor={`lk-${lesson.id}`}>
            <select id={`lk-${lesson.id}`} value={lesson.kind} onChange={(e) => set({ kind: e.target.value as Lesson['kind'] })}>
              <option value="text">Reading</option>
              <option value="video">Video</option>
            </select>
          </Field>
          <Field label="Minutes" htmlFor={`lm-${lesson.id}`}>
            <input id={`lm-${lesson.id}`} type="number" min={0} value={lesson.estimatedMinutes} onChange={(e) => set({ estimatedMinutes: Number(e.target.value) })} />
          </Field>
        </div>
        {lesson.kind === 'video' && (
          <div className="form-grid">
            <Field label="Video link" htmlFor={`lv-${lesson.id}`} hint="YouTube, Vimeo or a direct .mp4 link.">
              <input id={`lv-${lesson.id}`} type="url" value={lesson.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} />
            </Field>
            <Field label="Or upload a private video" htmlFor={`lu-${lesson.id}`} hint={lesson.mediaId ? 'Uploaded video attached. Only enrolled learners can stream it.' : 'MP4 or WebM.'}>
              <input
                id={`lu-${lesson.id}`}
                type="file"
                accept="video/mp4,video/webm"
                disabled={disabled || uploading}
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], 'video')}
              />
            </Field>
          </div>
        )}
        <div className="row between">
          <label className="label small" htmlFor={`lb-${lesson.id}`}>
            Content (Markdown)
          </label>
          <button type="button" className="link-button small" onClick={() => setPreview((v) => !v)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="card flat" style={{ margin: '6px 0 14px' }}>
            <Markdown source={lesson.body || '_Nothing yet._'} />
          </div>
        ) : (
          <textarea id={`lb-${lesson.id}`} rows={10} style={{ margin: '6px 0 14px' }} value={lesson.body} onChange={(e) => set({ body: e.target.value })} />
        )}
        <Field label="Downloads" htmlFor={`la-${lesson.id}`} hint="PDFs, images, slides or data files. Shared through expiring links.">
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {lesson.attachments.map((a, i) => (
              <li key={a.mediaId}>
                {a.name}{' '}
                <button type="button" className="link-button" onClick={() => set({ attachments: lesson.attachments.filter((_, j) => j !== i) })}>
                  remove
                </button>
              </li>
            ))}
          </ul>
          <input
            id={`la-${lesson.id}`}
            type="file"
            disabled={disabled || uploading}
            onChange={(e) => {
              if (e.target.files?.[0]) uploadFile(e.target.files[0], 'attachment');
              e.target.value = '';
            }}
          />
        </Field>
        <div className="row between">
          <label className="check small">
            <input type="checkbox" checked={lesson.required} onChange={(e) => set({ required: e.target.checked })} />
            Required for completion
          </label>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn small ghost" aria-label="Move lesson up" onClick={() => onMove(-1)}>
              ↑
            </button>
            <button type="button" className="btn small ghost" aria-label="Move lesson down" onClick={() => onMove(1)}>
              ↓
            </button>
            <button type="button" className="btn small danger" onClick={onDelete}>
              Delete lesson
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

export function QuizEditor(props: EditorProps) {
  const { content, disabled } = props;
  const edit = useEdit(props);
  const quiz = content.quiz;
  if (!quiz) {
    return (
      <fieldset disabled={disabled}>
        <p className="muted">No quiz yet. Quizzes are graded on the server and draw random questions from a bank you write.</p>
        <button
          type="button"
          className="btn"
          onClick={() =>
            edit(
              (d) =>
                void (d.quiz = {
                  id: newId('quiz'),
                  title: 'Check your understanding',
                  passPercent: 70,
                  questionsPerAttempt: 5,
                  maxAttempts: 3,
                  cooldownMinutes: 0,
                  questions: [],
                }),
            )
          }
        >
          Add a quiz
        </button>
      </fieldset>
    );
  }
  return (
    <fieldset disabled={disabled}>
      <div className="form-grid">
        <Field label="Title" htmlFor="qz-title">
          <input id="qz-title" value={quiz.title} onChange={(e) => edit((d) => void (d.quiz!.title = e.target.value))} />
        </Field>
        <Field label="Pass mark (%)" htmlFor="qz-pass">
          <input id="qz-pass" type="number" min={1} max={100} value={quiz.passPercent} onChange={(e) => edit((d) => void (d.quiz!.passPercent = Number(e.target.value)))} />
        </Field>
        <Field label="Questions per attempt" htmlFor="qz-per" hint={`Bank has ${quiz.questions.length}. A bigger bank makes retakes fairer.`}>
          <input id="qz-per" type="number" min={1} value={quiz.questionsPerAttempt} onChange={(e) => edit((d) => void (d.quiz!.questionsPerAttempt = Number(e.target.value)))} />
        </Field>
        <Field label="Attempts allowed" htmlFor="qz-max">
          <input id="qz-max" type="number" min={1} max={20} value={quiz.maxAttempts} onChange={(e) => edit((d) => void (d.quiz!.maxAttempts = Number(e.target.value)))} />
        </Field>
        <Field label="Wait between attempts (minutes)" htmlFor="qz-cool">
          <input id="qz-cool" type="number" min={0} value={quiz.cooldownMinutes} onChange={(e) => edit((d) => void (d.quiz!.cooldownMinutes = Number(e.target.value)))} />
        </Field>
      </div>
      <h3>Question bank</h3>
      {quiz.questions.map((q, qi) => (
        <div key={q.id} className="editor-block">
          <div className="editor-body" style={{ borderTop: 0, paddingTop: 14 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="spacer">
                <Field label={`Question ${qi + 1}`} htmlFor={`qp-${q.id}`}>
                  <textarea id={`qp-${q.id}`} rows={2} style={{ minHeight: 60 }} value={q.prompt} onChange={(e) => edit((d) => void (d.quiz!.questions[qi]!.prompt = e.target.value))} />
                </Field>
              </div>
              <Field label="Answer type" htmlFor={`qk-${q.id}`}>
                <select id={`qk-${q.id}`} value={q.kind} onChange={(e) => edit((d) => void (d.quiz!.questions[qi]!.kind = e.target.value as 'single' | 'multiple'))}>
                  <option value="single">One correct answer</option>
                  <option value="multiple">Several correct answers</option>
                </select>
              </Field>
            </div>
            {q.options.map((o, oi) => (
              <div key={o.id} className="row" style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
                <label className="check small" title="Correct answer">
                  <input
                    type={q.kind === 'single' ? 'radio' : 'checkbox'}
                    name={`correct-${q.id}`}
                    checked={o.correct}
                    onChange={(e) =>
                      edit((d) => {
                        const opts = d.quiz!.questions[qi]!.options;
                        if (q.kind === 'single') opts.forEach((x, j) => (x.correct = j === oi));
                        else opts[oi]!.correct = e.target.checked;
                      })
                    }
                  />
                  <span className="sr-only">Correct</span>
                </label>
                <input aria-label={`Option ${oi + 1}`} value={o.text} onChange={(e) => edit((d) => void (d.quiz!.questions[qi]!.options[oi]!.text = e.target.value))} />
                <button
                  type="button"
                  className="btn small ghost"
                  aria-label="Remove option"
                  disabled={q.options.length <= 2}
                  onClick={() => edit((d) => void d.quiz!.questions[qi]!.options.splice(oi, 1))}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="row between" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn small"
                disabled={q.options.length >= 8}
                onClick={() => edit((d) => void d.quiz!.questions[qi]!.options.push({ id: newId('opt'), text: '', correct: false }))}
              >
                Add option
              </button>
              <button type="button" className="btn small danger" onClick={() => edit((d) => void d.quiz!.questions.splice(qi, 1))}>
                Delete question
              </button>
            </div>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>Tick the correct {q.kind === 'single' ? 'answer' : 'answers'}. Learners never see which ones.</p>
          </div>
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() =>
            edit(
              (d) =>
                void d.quiz!.questions.push({
                  id: newId('q'),
                  prompt: '',
                  kind: 'single',
                  options: [
                    { id: newId('opt'), text: '', correct: true },
                    { id: newId('opt'), text: '', correct: false },
                  ],
                }),
            )
          }
        >
          Add question
        </button>
        <button
          type="button"
          className="btn ghost danger"
          onClick={() => confirm('Remove the quiz from this draft?') && edit((d) => void ((d.quiz = null), (d.completion.requireQuiz = false)))}
        >
          Remove quiz
        </button>
      </div>
    </fieldset>
  );
}

export function AssignmentEditor(props: EditorProps) {
  const { content, disabled } = props;
  const edit = useEdit(props);
  const a = content.assignment;
  if (!a) {
    return (
      <fieldset disabled={disabled}>
        <p className="muted">
          A practical assignment is the strongest evidence of learning. Learners submit work and a reviewer approves it against your rubric.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() =>
            edit(
              (d) =>
                void (d.assignment = {
                  id: newId('asg'),
                  title: 'Practical assignment',
                  prompt: '',
                  allowLink: true,
                  allowFile: true,
                  rubric: [{ id: newId('crit'), title: 'Meets the brief', description: '', required: true }],
                }),
            )
          }
        >
          Add an assignment
        </button>
      </fieldset>
    );
  }
  return (
    <fieldset disabled={disabled}>
      <Field label="Title" htmlFor="as-title">
        <input id="as-title" value={a.title} onChange={(e) => edit((d) => void (d.assignment!.title = e.target.value))} />
      </Field>
      <Field label="Instructions" htmlFor="as-prompt" hint="Markdown. Say exactly what to submit and how it will be judged.">
        <textarea id="as-prompt" rows={8} value={a.prompt} onChange={(e) => edit((d) => void (d.assignment!.prompt = e.target.value))} />
      </Field>
      <div className="row" style={{ marginBottom: 14 }}>
        <label className="check small">
          <input type="checkbox" checked={a.allowLink} onChange={(e) => edit((d) => void (d.assignment!.allowLink = e.target.checked))} />
          Accept links
        </label>
        <label className="check small">
          <input type="checkbox" checked={a.allowFile} onChange={(e) => edit((d) => void (d.assignment!.allowFile = e.target.checked))} />
          Accept file uploads
        </label>
      </div>
      <h3>Rubric</h3>
      <p className="small muted">Reviewers score each criterion. Approval needs every required criterion met.</p>
      {a.rubric.map((c, ci) => (
        <div key={c.id} className="editor-block">
          <div className="editor-body" style={{ borderTop: 0, paddingTop: 14 }}>
            <div className="form-grid">
              <Field label={`Criterion ${ci + 1}`} htmlFor={`cr-${c.id}`}>
                <input id={`cr-${c.id}`} value={c.title} onChange={(e) => edit((d) => void (d.assignment!.rubric[ci]!.title = e.target.value))} />
              </Field>
              <Field label="What good looks like" htmlFor={`cd-${c.id}`}>
                <input id={`cd-${c.id}`} value={c.description} onChange={(e) => edit((d) => void (d.assignment!.rubric[ci]!.description = e.target.value))} />
              </Field>
            </div>
            <div className="row between">
              <label className="check small">
                <input type="checkbox" checked={c.required} onChange={(e) => edit((d) => void (d.assignment!.rubric[ci]!.required = e.target.checked))} />
                Required to pass
              </label>
              <button type="button" className="btn small ghost" onClick={() => edit((d) => void d.assignment!.rubric.splice(ci, 1))}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => edit((d) => void d.assignment!.rubric.push({ id: newId('crit'), title: '', description: '', required: true }))}
        >
          Add criterion
        </button>
        <button
          type="button"
          className="btn ghost danger"
          onClick={() => confirm('Remove the assignment from this draft?') && edit((d) => void ((d.assignment = null), (d.completion.requireAssignment = false)))}
        >
          Remove assignment
        </button>
      </div>
    </fieldset>
  );
}

export function CompletionEditor(props: EditorProps) {
  const { content, disabled } = props;
  const edit = useEdit(props);
  const c = content.completion;
  return (
    <fieldset disabled={disabled}>
      <h3>What counts as completing</h3>
      <p className="small muted">
        Watching or reading is weak evidence on its own. Requiring a quiz and an approved assignment makes the credential mean more.
      </p>
      <label className="option">
        <input type="checkbox" checked={c.requireAllLessons} onChange={(e) => edit((d) => void (d.completion.requireAllLessons = e.target.checked))} />
        <span>Finish every required lesson</span>
      </label>
      <label className="option">
        <input type="checkbox" checked={c.requireQuiz} disabled={!content.quiz} onChange={(e) => edit((d) => void (d.completion.requireQuiz = e.target.checked))} />
        <span>
          Pass the quiz {!content.quiz && <span className="muted small">(add a quiz first)</span>}
        </span>
      </label>
      <label className="option">
        <input
          type="checkbox"
          checked={c.requireAssignment}
          disabled={!content.assignment}
          onChange={(e) => edit((d) => void (d.completion.requireAssignment = e.target.checked))}
        />
        <span>
          Get the assignment approved {!content.assignment && <span className="muted small">(add an assignment first)</span>}
        </span>
      </label>
      <h3 style={{ marginTop: 24 }}>Credential</h3>
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={content.credential.enabled} onChange={(e) => edit((d) => void (d.credential.enabled = e.target.checked))} />
        Issue a shareable credential on completion
      </label>
      {content.credential.enabled && (
        <>
          <Field label="Credential title" htmlFor="cr-title">
            <input id="cr-title" value={content.credential.title} onChange={(e) => edit((d) => void (d.credential.title = e.target.value))} />
          </Field>
          <Field label="Achievement criteria" htmlFor="cr-criteria" hint="Shown on the public verification page. Leave blank to describe the completion rules automatically.">
            <textarea id="cr-criteria" rows={3} value={content.credential.criteria} onChange={(e) => edit((d) => void (d.credential.criteria = e.target.value))} />
          </Field>
        </>
      )}
    </fieldset>
  );
}
