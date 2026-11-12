import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { DriveConnectionCard } from '../../features/drive/DriveConnectionCard';

export function AdminSettingsPage() {
  const { can } = useAuth();
  return <article><header className="event-page-heading"><div><h1>Nastavení</h1><p className="lead">Účet a přístupy k přípravě a moderování.</p></div></header>
    <div className="settings-sections">
      <section className="event-section"><h2>Můj účet</h2><p>Přihlášení a nastavení vašeho účtu.</p><Link className="secondary-link" to="/account">Otevřít můj účet</Link></section>
      {can('users.manage') && <section className="event-section"><h2>Uživatelé a přístupy</h2><p>Pozvánky a oprávnění spolupracovníků.</p><Link className="secondary-link" to="/admin/users">Spravovat přístupy</Link></section>}
      <DriveConnectionCard />
    </div>
  </article>;
}
