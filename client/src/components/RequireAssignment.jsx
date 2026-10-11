import { UserX2 } from 'lucide-react';
import { usePermissions } from '../context/PermissionContext.jsx';
import AppLayout from './AppLayout.jsx';

/**
 * Wraps every staff-facing page. Before this existed, a brand-new teacher
 * account with zero Class/Section/Subject assignments (created by an admin
 * but not yet assigned via Teacher Management) would log in and see a
 * completely empty-looking Overview/Assignments/Quizzes/etc — all-zero
 * counts, no explanation, indistinguishable from "the app is broken."
 *
 * This checks the real, backend-resolved scope (never a hardcoded role
 * check) for the one specific condition that means "this teacher has not
 * been assigned anything yet": scope.unrestricted === false (so it never
 * matches System Admin/Academic Head/an unrestricted Coordinator) AND
 * allowedClassLevels is an empty array (not null, which would mean
 * unrestricted, and not a populated list, which means they do have at
 * least one real assignment).
 */
export default function RequireAssignment({ children, title, subtitle }) {
  const { scope, loading } = usePermissions();
  if (loading) return children;

  const isUnassigned = scope && scope.unrestricted === false && Array.isArray(scope.allowedClassLevels) && scope.allowedClassLevels.length === 0;
  if (!isUnassigned) return children;

  return (
    <AppLayout title={title || 'Welcome'} subtitle="Your account is set up, but you haven't been assigned to any class yet">
      <div className="card card-pad" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
        }}>
          <UserX2 size={26} color="var(--text-dim)" />
        </div>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>You haven't been assigned to a class yet</h3>
        <p className="text-sm text-dim" style={{ lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
          Please tell your administrator to assign you a Class, Section, and Subject in <strong>Teacher Management</strong>.
          Once assigned, your Dashboard, Students, Assignments, Quizzes, Content, and Announcements will automatically
          unlock for that class — no further setup needed on your end.
        </p>
      </div>
    </AppLayout>
  );
}
