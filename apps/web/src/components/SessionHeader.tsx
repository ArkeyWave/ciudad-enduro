import { headers } from 'next/headers';
import { getMe } from '../lib/api';
import { SignOutButton } from './sign-in/SignOutButton';
import { LIME } from './sign-in/styles';

export async function SessionHeader() {
  const me = await getMe((await headers()).get('cookie') ?? '');
  return (
    <header
      style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 16, borderBottom: '1px solid #2A2A2A' }}
    >
      <a href="/" style={{ color: LIME, fontWeight: 700, textDecoration: 'none' }}>
        Ciudad Enduro
      </a>
      {me ? (
        <span style={{ display: 'flex', gap: 12 }}>
          {me.role === 'admin' && (
            <a href="/rutas/nueva" style={{ color: LIME }}>
              Nueva ruta
            </a>
          )}
          <span data-testid="session-email">{me.email}</span>
          <SignOutButton />
        </span>
      ) : (
        <a href="/ingresar" style={{ color: LIME }}>
          Ingresar
        </a>
      )}
    </header>
  );
}
