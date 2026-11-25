import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { productConfig } from '../config/product';
import { Brand } from '../ui/Brand';

export function AppLayout({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/" aria-label={`${productConfig.adminLabel} – úvod`}>
          <Brand />
        </NavLink>
        <NavLink className="nav-link" to="/admin">Administrace</NavLink>
      </header>
      <main className="page-shell">
        {children ?? <Outlet />}
      </main>
      <footer className="site-credit"><small>David Křenek <span aria-hidden="true">·</span> <NavLink to="/privacy">Ochrana osobních údajů</NavLink></small></footer>
    </div>
  );
}
