import { NavLink, Outlet } from 'react-router-dom';

import { productConfig } from '../config/product';
import { Brand } from '../ui/Brand';
import { currentOfflineMode } from '../features/offline/offlineAvailability';

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/" aria-label={`${productConfig.adminLabel} – úvod`}>
          <Brand />
        </NavLink>
        <NavLink className="nav-link" to="/admin">Administrace</NavLink>
        {currentOfflineMode() && <a className="nav-link" href="/offline.html">Spustit offline kvíz</a>}
      </header>
      <main className="page-shell">
        <Outlet />
      </main>
      <footer className="site-credit"><small>David Křenek <span aria-hidden="true">·</span> <NavLink to="/privacy">Ochrana osobních údajů</NavLink></small></footer>
    </div>
  );
}
