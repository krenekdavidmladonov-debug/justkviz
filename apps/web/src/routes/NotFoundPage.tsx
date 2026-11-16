import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="empty-state">
      <p className="eyebrow">404</p>
      <h1>Tahle stránka není na programu.</h1>
      <p>Zkontrolujte adresu, nebo se vraťte na seznam akcí.</p>
      <Link className="button-link" to="/">Zpět na akce</Link>
    </section>
  );
}
