import { Navigate, Outlet, useLocation, useNavigation } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { AdminLoading } from './AdminLoading';

export function RequireStaff() {
  const { currentUser, role, loading } = useAuth();
  const location = useLocation();
  const navigation = useNavigation();

  // A lazy sign-in or access page may still be loading after the redirect.
  if (loading || ((!currentUser || !role) && navigation.state !== 'idle')) {
    return <AdminLoading />;
  }

  if (!currentUser) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (!role) {
    return <Navigate to="/admin/no-access" replace />;
  }

  return <>
    {navigation.state !== 'idle' && <div className="admin-navigation-progress" role="status">Otevírám stránku…</div>}
    <Outlet />
  </>;
}
