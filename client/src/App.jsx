import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { GamificationProvider } from './context/GamificationContext.jsx';
import { PermissionProvider, usePermissions } from './context/PermissionContext.jsx';

const Login = lazy(() => import('./pages/auth/Login.jsx'));
const Register = lazy(() => import('./pages/auth/Register.jsx'));

const StudentDashboard = lazy(() => import('./pages/student/Dashboard.jsx'));
const Materials = lazy(() => import('./pages/student/Materials.jsx'));
const Assignments = lazy(() => import('./pages/student/Assignments.jsx'));
const Quizzes = lazy(() => import('./pages/student/Quizzes.jsx'));
const Announcements = lazy(() => import('./pages/student/Announcements.jsx'));
const StudentAttendance = lazy(() => import('./pages/student/Attendance.jsx'));
const AdminAttendance = lazy(() => import('./pages/admin/Attendance.jsx'));

const AdminOverview = lazy(() => import('./pages/admin/Overview.jsx'));
const ManageContent = lazy(() => import('./pages/admin/ManageContent.jsx'));
const AdminAssignments = lazy(() => import('./pages/admin/AdminAssignments.jsx'));
const AdminQuizzes = lazy(() => import('./pages/admin/AdminQuizzes.jsx'));
const AdminStudents = lazy(() => import('./pages/admin/AdminStudents.jsx'));
const AdminAnnouncements = lazy(() => import('./pages/admin/AdminAnnouncements.jsx'));
const AdminBranding = lazy(() => import('./pages/admin/AdminBranding.jsx'));
const AuditLog = lazy(() => import('./pages/admin/AuditLog.jsx'));
const AcademicSessions = lazy(() => import('./pages/admin/AcademicSessions.jsx'));
const MyPreferences = lazy(() => import('./pages/admin/MyPreferences.jsx'));
const Registry = lazy(() => import('./pages/admin/Registry.jsx'));
const TeacherManagement = lazy(() => import('./pages/admin/TeacherManagement.jsx'));
const RolesPermissions = lazy(() => import('./pages/admin/RolesPermissions.jsx'));
const QuestionBanks = lazy(() => import('./pages/admin/QuestionBanks.jsx'));
const CoordinatorDashboard = lazy(() => import('./pages/coordinator/CoordinatorDashboard.jsx'));
const AcademicHeadDashboard = lazy(() => import('./pages/academicHead/AcademicHeadDashboard.jsx'));
import RequireAssignment from './components/RequireAssignment.jsx';
const SetupPassword = lazy(() => import('./pages/auth/SetupPassword.jsx'));
const GuardianHome = lazy(() => import('./pages/guardian/GuardianHome.jsx'));
const ChildAttendance = lazy(() => import('./pages/guardian/ChildAttendance.jsx'));
const GuardianProfile = lazy(() => import('./pages/guardian/GuardianProfile.jsx'));
const Guardians = lazy(() => import('./pages/admin/Guardians.jsx'));
const FeeSignoff = lazy(() => import('./pages/admin/FeeSignoff.jsx'));
const Messages = lazy(() => import('./pages/admin/Messages.jsx'));
const StudentImport = lazy(() => import('./pages/admin/StudentImport.jsx'));

function FullScreenLoader() {
  const { t } = useTranslation('common');
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', background: 'var(--bg)' }}>
      {t('app.loading')}
    </div>
  );
}

function landingPathFor(user) {
  if (user?.role === 'teacher' && user?.staff_role === 'academic_head') return '/academic-head';
  if (user?.role === 'teacher' && user?.staff_role === 'coordinator') return '/coordinator';
  if (user?.role === 'guardian') return '/guardian';
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
          <Suspense fallback={<FullScreenLoader />}>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
            <Route path="/setup" element={<SetupPassword />} />

            <Route path="/guardian" element={<ProtectedRoute role="guardian"><GuardianHome /></ProtectedRoute>} />
            <Route path="/guardian/profile" element={<ProtectedRoute role="guardian"><GuardianProfile /></ProtectedRoute>} />
            <Route path="/guardian/children/:studentId" element={<ProtectedRoute role="guardian"><ChildAttendance /></ProtectedRoute>} />

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
            <Route path="/admin/guardians" element={<ProtectedRoute role="admin"><Guardians /></ProtectedRoute>} />
            <Route path="/admin/fee-signoff" element={<RequirePermissionRoute perm="fees.signoff_daily"><FeeSignoff /></RequirePermissionRoute>} />
            <Route path="/admin/messages" element={<ProtectedRoute role="admin"><Messages /></ProtectedRoute>} />
            <Route path="/admin/student-import" element={<ProtectedRoute role="admin"><StudentImport /></ProtectedRoute>} />
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
          </Suspense>
        </GamificationProvider>
        </ToastProvider>
        </SettingsProvider>
        </PermissionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
