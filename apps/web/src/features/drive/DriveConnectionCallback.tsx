import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { clearDriveConnectionState, clearForeignDriveConnectionState, finishDriveConnection } from './session';

export function DriveConnectionSessionGuard() {
  const { currentUser, loading } = useAuth();
  useEffect(() => { if (!loading) clearForeignDriveConnectionState(currentUser?.uid ?? null); }, [currentUser?.uid, loading]);
  return null;
}

export function DriveConnectionCallback() {
  const { currentUser, membership, can, loading } = useAuth();
  const location = useLocation();
  const [query] = useState(location.search);
  const navigate = useNavigate();
  const allowed = membership?.role === 'owner' && can('users.manage') && can('quiz.media.upload');
  // Remove the one-time code before waiting for Auth or invoking a callable.
  useLayoutEffect(() => { window.history.replaceState(window.history.state, '', window.location.pathname); }, []);
  useEffect(() => {
    if (loading) return;
    let active = true;
    if (!currentUser || !allowed) {
      clearDriveConnectionState();
      void navigate('/admin/settings', { replace: true, state: { driveConnectionResult: 'forbidden' } });
      return;
    }
    void finishDriveConnection(currentUser.uid, query).then(result => {
      if (active) void navigate('/admin/settings', { replace: true, state: { driveConnectionResult: result } });
    });
    return () => { active = false; };
  }, [currentUser, allowed, loading, navigate, query]);
  return <article aria-busy="true"><h1>Připojení Google Disku</h1><p role="status">Dokončuji připojení…</p></article>;
}
