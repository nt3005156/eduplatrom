import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { GamificationProvider } from './context/GamificationContext.jsx';
import { PermissionProvider, usePermissions } from './context/PermissionContext.jsx';

import Login from './pages/auth/Login.jsx';
import Register from './pages/auth/Register.jsx';

import StudentDashboard from './pages/student/Dashboard.jsx';
import Materials from './pages/student/Materials.jsx';
import Assignments from './pages/student/Assignments.jsx';
import Quizzes from './pages/student/Quizzes.jsx';
import Announcements from './pages/student/Announcements.jsx';
import StudentAttendance from './pages/student/Attendance.jsx';
import AdminAttendance from './pages/admin/Attendance.jsx';

import AdminOverview from './pages/admin/Overview.jsx';
import ManageContent from './pages/admin/ManageContent.jsx';
import AdminAssignments from './pages/admin/AdminAssignments.jsx';
import AdminQuizzes from './pages/admin/AdminQuizzes.jsx';
import AdminStudents from './pages/admin/AdminStudents.jsx';
import AdminAnnouncements from './pages/admin/AdminAnnouncements.jsx';
import AdminBranding from './pages/admin/AdminBranding.jsx';
import AuditLog from './pages/admin/AuditLog.jsx';
import AcademicSessions from './pages/admin/AcademicSessions.jsx';
import MyPreferences from './pages/admin/MyPreferences.jsx';
import Registry from './pages/admin/Registry.jsx';
import TeacherManagement from './pages/admin/TeacherManagement.jsx';
import RolesPermissions from './pages/admin/RolesPermissions.jsx';
import QuestionBanks from './pages/admin/QuestionBanks.jsx';
import CoordinatorDashboard from './pages/coordinator/CoordinatorDashboard.jsx';
import AcademicHeadDashboard from './pages/academicHead/AcademicHeadDashboard.jsx';
import RequireAssignment from './components/RequireAssignment.jsx';

function FullScreenLoader() {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', background: 'var(--bg)' }}>
      Loading NITEX...
    </div>
  );
}

function landingPathFor(user) {
  if (user?.role === 'teacher' && user?.staff_role === 'academic_head') return '/academic-head';
  if (user?.role === 'teacher' && user?.staff_role === 'coordinator') return '/coordinator';
  return user?.role === 'admin' || user?.role === 'teacher' ? '/admin' : '/dashboard';
}

function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  const allowedRoles = Array.isArray(role) ? role : role ? [role] : null;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to={landingPathFor(user)} replace />;
  return children;
}

/** Route-level guard driven by the real resolved permission set (not a
 * hardcoded role name) — e.g. /coordinator requires 'analytics.view_school_wide',
 * which today defaults to Coordinator/Exam Coordinator/Academic Head/System
 * Admin, and will automatically include any future custom role granted that
 * permission with zero code change. */
function RequirePermissionRoute({ perm, children }) {
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: permLoading } = usePermissions();
  if (authLoading || permLoading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasPermission(perm)) return <Navigate to={landingPathFor(user)} replace />;
  return children;
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={landingPathFor(user)} replace />;
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={landingPathFor(user)} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PermissionProvider>
        <SettingsProvider>
        <ToastProvider>
        <GamificationProvider>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />

            <Route path="/dashboard" element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>} />
            <Route path="/materials" element={<ProtectedRoute role="student"><Materials /></ProtectedRoute>} />
            <Route path="/assignments" element={<ProtectedRoute role="student"><Assignments /></ProtectedRoute>} />
            <Route path="/quizzes" element={<ProtectedRoute role="student"><Quizzes /></ProtectedRoute>} />
            <Route path="/announcements" element={<ProtectedRoute role="student"><Announcements /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute role="student"><StudentAttendance /></ProtectedRoute>} />

            <Route path="/admin" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Overview"><AdminOverview /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/content" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Manage Content"><ManageContent /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/assignments" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Assignments"><AdminAssignments /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/quizzes" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Quizzes"><AdminQuizzes /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/question-banks" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Question Banks"><QuestionBanks /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/students" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Students"><AdminStudents /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/attendance" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Attendance"><AdminAttendance /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/announcements" element={<ProtectedRoute role={['admin', 'teacher']}><RequireAssignment title="Announcements"><AdminAnnouncements /></RequireAssignment></ProtectedRoute>} />
            <Route path="/admin/branding" element={<ProtectedRoute role="admin"><AdminBranding /></ProtectedRoute>} />
            <Route path="/admin/audit-log" element={<RequirePermissionRoute perm="audit.view"><AuditLog /></RequirePermissionRoute>} />
            <Route path="/admin/academic-sessions" element={<ProtectedRoute role="admin"><AcademicSessions /></ProtectedRoute>} />
            <Route path="/admin/preferences" element={<ProtectedRoute role={['admin', 'teacher']}><MyPreferences /></ProtectedRoute>} />
            <Route path="/admin/registry" element={<ProtectedRoute role="admin"><Registry /></ProtectedRoute>} />
            <Route path="/admin/teachers" element={<ProtectedRoute role="admin"><TeacherManagement /></ProtectedRoute>} />
            <Route path="/admin/roles-permissions" element={<ProtectedRoute role="admin"><RolesPermissions /></ProtectedRoute>} />
            <Route path="/coordinator" element={<RequirePermissionRoute perm="analytics.view_school_wide"><CoordinatorDashboard /></RequirePermissionRoute>} />
            <Route path="/academic-head" element={<RequirePermissionRoute perm="analytics.view_school_wide"><AcademicHeadDashboard /></RequirePermissionRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </GamificationProvider>
        </ToastProvider>
        </SettingsProvider>
        </PermissionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
