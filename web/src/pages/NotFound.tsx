import { Link } from 'react-router-dom';
import { usePageTitle } from '../components/ui';

export function NotFound() {
  usePageTitle('Not found');
  return (
    <div className="container narrow page">
      <h1>Page not found</h1>
      <p className="muted">The link may be old, or the page may have moved.</p>
      <Link className="btn" to="/">
        Go home
      </Link>
    </div>
  );
}
