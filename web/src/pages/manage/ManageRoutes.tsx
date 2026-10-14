import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes, useOutletContext, useParams, Outlet } from 'react-router-dom';
import { get } from '../../api';
import { brandProps, CommunityLogo, ErrorNotice, Spinner, usePageTitle } from '../../components/ui';
import type { CommunityDetail, Role } from '../../types';
import { ManageOverview } from './Overview';
import { CoursesList } from './CoursesList';
import { CourseBuilder } from './CourseBuilder';
import { ReviewQueue, ReviewDetail } from './Reviews';
import { AppealsPage } from './Appeals';
import { RewardsAdmin } from './Rewards';
import { MembersPage } from './Members';
import { CommunitySettings } from './CommunitySettings';
import { AnalyticsPage } from './Analytics';
import { AuditPage } from './Audit';
import { IssuedCredentials } from './IssuedCredentials';

export interface ManageContext {
  community: CommunityDetail['community'];
  role: Role | 'admin';
  isOwner: boolean;
  refresh: () => Promise<unknown>;
}

export function useManage() {
  return useOutletContext<ManageContext>();
}

function ManageLayout() {
  const { slug = '' } = useParams();
  const query = useQuery({ queryKey: ['community', slug], queryFn: () => get<CommunityDetail>(`/api/communities/${slug}`) });
  usePageTitle(query.data ? `Manage ${query.data.community.name}` : 'Manage');
  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <div className="container page">
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }
  const { community, membership, viewerIsPlatformAdmin } = query.data!;
  const role: Role | 'admin' | null = membership && membership.role !== 'member' ? membership.role : viewerIsPlatformAdmin ? 'admin' : null;
  if (!role) {
    return (
      <div className="container narrow page">
        <h1>Staff only</h1>
        <p className="muted">Only owners and instructors of {community.name} can manage it.</p>
        <Link className="btn" to={`/c/${community.slug}`}>
          Back to community
        </Link>
      </div>
    );
  }
  const isOwner = role === 'owner' || role === 'admin';
  const base = `/manage/${community.slug}`;
  const tabs = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/courses`, label: 'Courses' },
    { to: `${base}/reviews`, label: 'Reviews' },
    ...(isOwner ? [{ to: `${base}/appeals`, label: 'Appeals' }] : []),
    { to: `${base}/rewards`, label: 'Rewards' },
    { to: `${base}/members`, label: 'Members' },
    { to: `${base}/credentials`, label: 'Credentials' },
    { to: `${base}/analytics`, label: 'Analytics' },
    ...(isOwner ? [{ to: `${base}/settings`, label: 'Settings' }, { to: `${base}/audit`, label: 'Audit log' }] : []),
  ];
  return (
    <div {...brandProps(community.accentColor)}>
      <section className="banner" style={{ paddingBottom: 0 }}>
        <div className="container">
          <div className="row" style={{ marginBottom: 14 }}>
            <CommunityLogo name={community.name} logoUrl={community.logoUrl} small />
            <div className="spacer">
              <div className="tiny muted">Managing</div>
              <h2 style={{ margin: 0 }}>{community.name}</h2>
            </div>
            <span className="badge accent">{role === 'admin' ? 'Platform admin' : role === 'owner' ? 'Owner' : 'Instructor'}</span>
            <Link className="btn small" to={`/c/${community.slug}`}>
              View as member
            </Link>
          </div>
          {community.status === 'suspended' && (
            <p className="notice bad small">This community is suspended by the platform. Learners can't access it.</p>
          )}
          <nav className="tabs" aria-label="Management" style={{ marginBottom: 0, borderBottom: 0 }}>
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </section>
      <div className="container page">
        <Outlet context={{ community, role, isOwner, refresh: () => query.refetch() } satisfies ManageContext} />
      </div>
    </div>
  );
}

export default function ManageRoutes() {
  return (
    <Routes>
      <Route element={<ManageLayout />}>
        <Route index element={<ManageOverview />} />
        <Route path="courses" element={<CoursesList />} />
        <Route path="courses/:courseId" element={<CourseBuilder />} />
        <Route path="reviews" element={<ReviewQueue />} />
        <Route path="reviews/:submissionId" element={<ReviewDetail />} />
        <Route path="appeals" element={<AppealsPage />} />
        <Route path="rewards" element={<RewardsAdmin />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="credentials" element={<IssuedCredentials />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<CommunitySettings />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
    </Routes>
  );
}
