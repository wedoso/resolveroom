import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, PageLoading, useAuth } from './components';
import {
  AgentsPage,
  DashboardPage,
  JoinPage,
  LandingPage,
  NewConflictPage,
  NotificationsPage,
  NotFoundPage,
  SharePage,
  SignInPage,
} from './pages';
import { ConflictRoomPage } from './conflict-room';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  return children;
}
export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/conflicts/new"
          element={
            <PrivateRoute>
              <NewConflictPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/conflicts/:id"
          element={
            <PrivateRoute>
              <ConflictRoomPage />
            </PrivateRoute>
          }
        />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route
          path="/agents"
          element={
            <PrivateRoute>
              <AgentsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <PrivateRoute>
              <NotificationsPage />
            </PrivateRoute>
          }
        />
        <Route path="/share/:token" element={<SharePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
