import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthProvider';
import { roleLabels } from '@filmovy-kviz/quiz-domain';
import { productConfig } from '../config/product';
import { Brand } from '../ui/Brand';
import { EventNavigation } from '../features/events/EventNavigation';

const navigation = [
  { to: '/admin/quizzes', label: 'Kvízy', end: false },
  { to: '/admin/events', label: 'Akce', end: false },
  { to: '/admin/settings', label: 'Nastavení', end: false },
] as const;

function AdminNavigation() {
  const { can } = useAuth();
  return (
    <nav className="admin-navigation" aria-label="Administrace">
      {navigation.filter(item => item.to === '/admin/settings' || (item.to === '/admin/quizzes' ? can('quiz.read') : can('event.read'))).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          data-area={item.to === '/admin/quizzes' ? 'quizzes' : item.to === '/admin/events' ? 'events' : 'overview'}
          className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AdminShell() {
  const { pathname } = useLocation();
  const area = pathname.startsWith('/admin/quizzes') ? 'quizzes' : pathname.startsWith('/admin/events') ? 'events' : 'overview';
  const { currentUser, membership, signOut } = useAuth();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
    } finally {
      setPending(false);
    }
  }

  const accountLabel = membership ? roleLabels[membership.role] : 'Uživatel';
  const environmentTitle = `Projekt V2: ${import.meta.env.VITE_FIREBASE_PROJECT_ID}`;

  return (
    <div className="admin-shell" data-area={area}>
      <aside className="admin-sidebar">
        <div className="admin-brand-group">
          <NavLink className="admin-brand" to="/admin" aria-label={`${productConfig.adminLabel} – přehled`}>
            <span><strong><Brand /></strong><small>Administrace</small></span>
          </NavLink>
          <span className="admin-environment-label" title={environmentTitle}>V2</span>
        </div>
        <AdminNavigation />
        <div className="admin-account">
          <span>{accountLabel}</span>
          <strong>{currentUser?.email}</strong>
          <button type="button" className="quiet-button" onClick={() => void handleSignOut()} disabled={pending}>
            {pending ? 'Odhlašuji…' : 'Odhlásit se'}
          </button>
        </div>
      </aside>

      <header className="admin-mobile-header">
        <div className="admin-brand-group">
          <NavLink className="admin-brand" to="/admin" aria-label={`${productConfig.adminLabel} – přehled`}>
            <strong><Brand /></strong>
          </NavLink>
          <span className="admin-environment-label" title={environmentTitle}>V2</span>
        </div>
        <details className="admin-nav-disclosure">
          <summary aria-label="Otevřít navigaci administrace">Menu</summary>
          <div className="admin-mobile-menu">
            <AdminNavigation />
            <div className="admin-account compact">
              <span>{accountLabel}</span>
              <strong>{currentUser?.email}</strong>
              <button type="button" className="quiet-button" onClick={() => void handleSignOut()} disabled={pending}>
                {pending ? 'Odhlašuji…' : 'Odhlásit se'}
              </button>
            </div>
          </div>
        </details>
      </header>

      <main className="admin-main" id="main-content">
        <div className="admin-content">
          <EventNavigation />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
