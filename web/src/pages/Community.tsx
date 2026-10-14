import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ApiError, get, post } from '../api';
import { useAuth } from '../auth';
import { CourseCardView } from '../components/CourseCard';
import {
  brandProps,
  Avatar,
  CommunityLogo,
  Empty,
  ErrorNotice,
  formatDate,
  Markdown,
  plural,
  RequirementsPanel,
  RuleTree,
  Spinner,
  usePageTitle,
  useToast,
} from '../components/ui';
import type { CommunityDetail, CourseCard } from '../types';

type Tab = 'courses' | 'about' | 'members';

export function CommunityPage() {
  const { slug = '' } = useParams();
  const { user, openSignIn } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('courses');
  const detail = useQuery({ queryKey: ['community', slug], queryFn: () => get<CommunityDetail>(`/api/communities/${slug}`) });
  const communityId = detail.data?.community.id;
  const staff = Boolean(detail.data?.membership && detail.data.membership.role !== 'member') || Boolean(detail.data?.viewerIsPlatformAdmin);
  const courses = useQuery({
    queryKey: ['community-courses', communityId, staff],
    enabled: Boolean(communityId),
    queryFn: () => get<{ courses: CourseCard[] }>(`/api/communities/${communityId}/courses${staff ? '?all=1' : ''}`),
  });
  const members = useQuery({
    queryKey: ['members', communityId],
    enabled: Boolean(communityId && detail.data?.membership && tab === 'members'),
    queryFn: () => get<{ members: { userId: string; displayName: string; role: string; joinedAt: string }[] }>(`/api/communities/${communityId}/members`),
  });
  usePageTitle(detail.data?.community.name);

  const join = useMutation({
    mutationFn: () => post(`/api/communities/${communityId}/join`),
    onSuccess: () => {
      toast(`Welcome to ${detail.data?.community.name}`);
      qc.invalidateQueries();
    },
  });
  const leave = useMutation({
    mutationFn: () => post(`/api/communities/${communityId}/leave`),
    onSuccess: () => {
      toast('You left the community. Your progress and credentials are kept.');
      qc.invalidateQueries();
    },
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.error) {
    return (
      <div className="container page">
        <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />
      </div>
    );
  }
  const { community, membership, join: requirements } = detail.data!;
  const joinError = join.error instanceof ApiError ? join.error : null;

  return (
    <div {...brandProps(community.accentColor)}>
      <section className="banner">
        <div className="container">
          <div className="row">
            <CommunityLogo name={community.name} logoUrl={community.logoUrl} />
            <div className="spacer" style={{ minWidth: 220 }}>
              <h1 style={{ marginBottom: 4 }}>{community.name}</h1>
              {community.tagline && <p className="muted" style={{ margin: 0 }}>{community.tagline}</p>}
              <div className="meta" style={{ marginTop: 8 }}>
                <span>{plural(community.memberCount, 'member')}</span>
                <span>Since {formatDate(community.createdAt)}</span>
                {community.status === 'suspended' && <span className="badge bad">Suspended</span>}
              </div>
            </div>
            <div className="row">
              {staff && (
                <Link className="btn" to={`/manage/${community.slug}`}>
                  Manage
                </Link>
              )}
              {membership ? (
                <span className="badge ok">{membership.role === 'member' ? 'You are a member' : `You are ${membership.role === 'owner' ? 'an owner' : 'an instructor'}`}</span>
              ) : user ? (
                <button
                  className="btn primary"
                  disabled={join.isPending || requirements.state === 'ineligible'}
                  onClick={() => join.mutate()}
                >
                  {join.isPending ? 'Joining…' : 'Join community'}
                </button>
              ) : (
                <button className="btn primary" onClick={openSignIn}>
                  Sign in to join
                </button>
              )}
            </div>
          </div>
          {!membership && requirements.state !== 'open' && (
            <div className="card flat" style={{ marginTop: 18, maxWidth: 640 }}>
              <RequirementsPanel requirements={requirements} title="To join" />
              {requirements.evaluated && requirements.state === 'ineligible' && (
                <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  Holding the token in another wallet? <Link to="/settings">Link that wallet</Link> to your account and come back.
                </p>
              )}
            </div>
          )}
          {joinError && (
            <div className="notice bad" style={{ marginTop: 14, maxWidth: 640 }} role="alert">
              <strong>{joinError.message}</strong>
              {joinError.details?.requirements?.result && <RuleTree result={joinError.details.requirements.result} />}
            </div>
          )}
        </div>
      </section>

      <div className="container page" style={{ paddingTop: 16 }}>
        <div className="tabs" role="tablist">
          {(['courses', 'about', ...(membership ? ['members'] : [])] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'courses' ? 'Courses' : t === 'about' ? 'About' : 'Members'}
            </button>
          ))}
        </div>

        {tab === 'courses' && (
          <>
            {courses.isLoading && <Spinner />}
            {courses.error && <ErrorNotice error={courses.error} />}
            {courses.data && courses.data.courses.length === 0 && (
              <Empty>
                No courses yet.
                {staff && (
                  <div style={{ marginTop: 10 }}>
                    <Link className="btn small" to={`/manage/${community.slug}/courses`}>
                      Create the first course
                    </Link>
                  </div>
                )}
              </Empty>
            )}
            <div className="grid">
              {courses.data?.courses.map((c) => (
                <CourseCardView key={c.id} course={c} />
              ))}
            </div>
          </>
        )}

        {tab === 'about' && (
          <div className="narrow">
            {community.description ? <Markdown source={community.description} /> : <p className="muted">No description yet.</p>}
            <h3 style={{ marginTop: 24 }}>Membership</h3>
            <p>{requirements.summary}.</p>
            {membership && membership.role !== 'owner' && (
              <button
                className="btn danger small"
                onClick={() => {
                  if (confirm(`Leave ${community.name}? Your progress and credentials are kept.`)) leave.mutate();
                }}
              >
                Leave community
              </button>
            )}
            {leave.error && <ErrorNotice error={leave.error} />}
          </div>
        )}

        {tab === 'members' && (
          <>
            {members.isLoading && <Spinner />}
            {members.error && <ErrorNotice error={members.error} />}
            <div className="grid">
              {members.data?.members.map((m) => (
                <div key={m.userId} className="card tight flat row">
                  <Avatar name={m.displayName} />
                  <div className="spacer">
                    <div style={{ fontWeight: 600 }}>{m.displayName}</div>
                    <div className="tiny muted">Joined {formatDate(m.joinedAt)}</div>
                  </div>
                  {m.role !== 'member' && <span className="badge accent">{m.role === 'owner' ? 'Owner' : 'Instructor'}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
