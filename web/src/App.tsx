import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { Landing } from './pages/Landing';
import { Communities } from './pages/Communities';
import { CommunityPage } from './pages/Community';
import { CoursePreviewPage } from './pages/CoursePreview';
import { Dashboard } from './pages/Dashboard';
import { RewardsPage } from './pages/Rewards';
import { CredentialsPage } from './pages/Credentials';
import { CertificatePage, VerifyPage } from './pages/Verify';
import { SettingsPage } from './pages/Settings';
import { NewCommunityPage } from './pages/NewCommunity';
import { InvitePage } from './pages/Invite';
import { NotFound } from './pages/NotFound';
import { Player } from './pages/learn/Player';
import { LearnOverview } from './pages/learn/Overview';
import { LessonPage } from './pages/learn/Lesson';
import { QuizPage } from './pages/learn/Quiz';
import { AssignmentPage } from './pages/learn/Assignment';

const ManageRoutes = lazy(() => import('./pages/manage/ManageRoutes'));
const AdminPage = lazy(() => import('./pages/admin/Admin'));

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, openSignIn } = useAuth();
  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="container narrow page">
        <div className="card">
          <h1>Sign in to continue</h1>
          <p className="muted">Connect your wallet to see your learning, rewards and credentials.</p>
          <button className="btn primary" onClick={openSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="communities" element={<Communities />} />
        <Route path="c/:slug" element={<CommunityPage />} />
        <Route path="courses/:courseId" element={<CoursePreviewPage />} />
        <Route path="verify/:publicId" element={<VerifyPage />} />
        <Route path="invite/:token" element={<InvitePage />} />
        <Route path="dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="rewards" element={<RequireAuth><RewardsPage /></RequireAuth>} />
        <Route path="credentials" element={<RequireAuth><CredentialsPage /></RequireAuth>} />
        <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="new-community" element={<RequireAuth><NewCommunityPage /></RequireAuth>} />
        <Route path="learn/:courseId" element={<RequireAuth><Player /></RequireAuth>}>
          <Route index element={<LearnOverview />} />
          <Route path="lessons/:lessonId" element={<LessonPage />} />
          <Route path="quiz" element={<QuizPage />} />
          <Route path="assignment" element={<AssignmentPage />} />
        </Route>
        <Route
          path="manage/:slug/*"
          element={
            <RequireAuth>
              <Suspense fallback={<Spinner />}>
                <ManageRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="admin/*"
          element={
            <RequireAuth>
              <Suspense fallback={<Spinner />}>
                <AdminPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="certificate/:publicId" element={<CertificatePage />} />
    </Routes>
  );
}
