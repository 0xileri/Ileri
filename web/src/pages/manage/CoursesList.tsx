import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../../api';
import { Empty, ErrorNotice, Field, Spinner } from '../../components/ui';
import type { CourseCard } from '../../types';
import { useManage } from './ManageRoutes';

export function CoursesList() {
  const { community } = useManage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const query = useQuery({
    queryKey: ['community-courses', community.id, true],
    queryFn: () => get<{ courses: CourseCard[] }>(`/api/communities/${community.id}/courses?all=1`),
  });
  const create = useMutation({
    mutationFn: () => post<{ course: { id: string } }>(`/api/communities/${community.id}/courses`, { title }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['community-courses'] });
      navigate(`/manage/${community.slug}/courses/${data.course.id}`);
    },
  });
  return (
    <div className="stack">
      <form
        className="card flat"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>New course</h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="spacer" style={{ minWidth: 220 }}>
            <Field label="Title" htmlFor="new-course-title">
              <input id="new-course-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Intro to wallet security" />
            </Field>
          </div>
          <button className="btn primary" style={{ marginBottom: 14 }} disabled={create.isPending || title.trim().length < 2}>
            Create draft
          </button>
        </div>
        {create.error && <ErrorNotice error={create.error} />}
      </form>
      {query.isLoading && <Spinner />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data && query.data.courses.length === 0 && <Empty>No courses yet.</Empty>}
      {query.data && query.data.courses.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Status</th>
                <th>Access</th>
                <th className="num">Lessons</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data.courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.title}</strong>
                    {c.versionNumber && <div className="tiny muted">Live version {c.versionNumber}</div>}
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'published' ? 'ok' : c.status === 'draft' ? 'warn' : ''}`}>{c.status}</span>
                  </td>
                  <td className="small">{c.accessSummary}</td>
                  <td className="num">{c.lessonCount}</td>
                  <td>
                    <Link className="btn small" to={`/manage/${community.slug}/courses/${c.id}`}>
                      Edit
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
