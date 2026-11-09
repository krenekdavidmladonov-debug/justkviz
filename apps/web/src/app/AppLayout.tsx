import { NavLink, Outlet } from 'react-router-dom';

import { productConfig } from '../config/product';
import { Brand } from '../ui/Brand';

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/" aria-label={`${productConfig.adminLabel} – úvod`}>
          <Brand />
        </NavLink>
        <NavLink className="nav-link" to="/admin">Administrace</NavLink>
        {import.meta.env.VITE_FIREBASE_USE_EMULATORS === 'true' && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'demo-filmovy-kviz-v2'
          && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)
          && <a className="nav-link" href="/offline.html">Spustit offline kvíz</a>}
      </header>
      <main className="page-shell">
        <Outlet />
      </main>
      <footer className="site-credit"><small>David Křenek</small><NavLink to="/privacy">Ochrana osobních údajů</NavLink></footer>
    </div>
  );
}
