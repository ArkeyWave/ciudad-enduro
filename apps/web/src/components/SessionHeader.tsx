import { Suspense } from 'react';
import { currentUser } from '../lib/session';
import { SignOutButton } from './sign-in/SignOutButton';

async function Session() {
  const me = await currentUser();
  return me ? (
    <span className="session">
      <span data-testid="session-email" className="session-email" title={me.email}>
        {me.email}
      </span>
      <SignOutButton />
    </span>
  ) : (
    <a href="/ingresar" className="session">
      Ingresar
    </a>
  );
}

/** The top bar. The session slot streams in, so a slow /api/me never holds the page. */
export function SessionHeader() {
  return (
    <header className="topbar">
      <a href="/" className="wordmark">
        Ciudad Enduro
      </a>
      <Suspense fallback={<span className="session" aria-hidden="true" />}>
        <Session />
      </Suspense>
    </header>
  );
}
