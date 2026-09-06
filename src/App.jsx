import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.jsx";
import { OnboardingWizard } from "./components/OnboardingWizard.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { AppPage } from "./pages/AppPage.jsx";
import { AdminPage } from "./pages/AdminPage.jsx";
import { ForgePage } from "./pages/ForgePage.jsx";
import { ForgeLessonPage } from "./pages/ForgeLessonPage.jsx";
import { ForgeSubjectPage } from "./pages/ForgeSubjectPage.jsx";
import { AboutPage } from "./pages/AboutPage.jsx";
import { LandingPage, PublicLandingPage } from "./pages/LandingPage.jsx";
import { LeaderboardPage } from "./pages/LeaderboardPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";
import { TimetablePage } from "./pages/TimetablePage.jsx";
import { canAccessAdmin } from "./utils/permissions.js";

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-text-primary p-6">
      <div className="flex flex-col items-center gap-4">
        <div
          className="loading-spinner-lg animate-spin-slow rounded-full border-primary/20 border-t-primary"
          style={{ willChange: "transform" }}
          role="status"
          aria-label="Loading"
        />
        <p className="loading-overlay-subtitle font-bold tracking-widest uppercase text-text-muted">Loading</p>
      </div>
    </main>
  );
}

function ProtectedRoute({ children }) {
  const { isFirebaseConfigured, loading, user, profile } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isFirebaseConfigured && !user) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <LoadingScreen />;
  if (!profile.onboardingCompleted || profile.name === "Lock-on Learner") return <OnboardingWizard />;
  return <AppShell>{children}</AppShell>;
}

function AdminRoute({ children }) {
  const { isFirebaseConfigured, loading, user, profile } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isFirebaseConfigured && !user) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessAdmin(profile, user.email)) return <Navigate to="/app" replace />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<PublicLandingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/forge"
        element={
          <ProtectedRoute>
            <ForgePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/forge/subject/:subjectId"
        element={
          <ProtectedRoute>
            <ForgeSubjectPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/forge/lesson/:subjectId/:lessonId"
        element={
          <ProtectedRoute>
            <ForgeLessonPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/leaderboard"
        element={
          <ProtectedRoute>
            <LeaderboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/timetable"
        element={
          <ProtectedRoute>
            <TimetablePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
