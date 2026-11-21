import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
      <div>
        <p className="font-mono notranslate text-sm text-brand">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-subtle">The page you are looking for does not exist.</p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
