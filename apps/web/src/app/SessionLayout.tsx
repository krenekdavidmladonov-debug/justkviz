import { Outlet } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { DriveConnectionSessionGuard } from '../features/drive/DriveConnectionCallback';
import '../styles/editor.css';
import '../styles/access.css';

export function SessionLayout() {
  return <AuthProvider><DriveConnectionSessionGuard /><Outlet /></AuthProvider>;
}
