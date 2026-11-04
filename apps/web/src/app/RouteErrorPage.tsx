import { Link, useLocation, useRouteError } from 'react-router-dom';

import { Brand } from '../ui/Brand';

export function RouteErrorPage() {
  const error: unknown = useRouteError();
  const { pathname } = useLocation();
  const moduleFailed = error instanceof Error && /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed/i.test(error.message);
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/"><Brand /></Link>
      </header>
      <main className="page-shell">
        <section className="admin-centered" aria-labelledby="route-error-title">
          <p className="eyebrow">Načítání stránky</p>
          <h1 id="route-error-title">{moduleFailed ? 'Stránku se nepodařilo načíst.' : 'Něco se nepovedlo.'}</h1>
          <p>{moduleFailed
            ? 'Část aplikace není dostupná. Příčinou může být aktualizace nebo výpadek připojení. Zkontrolujte připojení a obnovte stránku.'
            : 'Zkuste stránku obnovit. Pokud potíže přetrvávají, vraťte se na přehled a zkuste to později.'}</p>
          <p>Obnovením můžete přijít o neuložené změny.</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>Obnovit stránku</button>
          <Link className="nav-link" to={inAdmin ? '/admin' : '/'}>{inAdmin ? 'Zpět do administrace' : 'Zpět na akce'}</Link>
        </section>
      </main>
    </div>
  );
}
