import { headers } from 'next/headers';
import { getMe } from '../lib/api';
import { isAdmin } from '../lib/roles';
import { SignOutButton } from './sign-in/SignOutButton';
import { LIME } from './sign-in/styles';

export async function SessionHeader() {
  const me = await getMe((await headers()).get('cookie') ?? '');
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        borderBottom: '1px solid #2A2A2A',
      }}
    >
      <a href="/" style={{ color: LIME, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
        Ciudad Enduro
      </a>
      {me ? (
        // min-width 0 lets the e-mail shrink, so a long address never pushes "Salir" off a phone screen.
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {isAdmin(me) && (
            <a href="/rutas/nueva" style={{ color: LIME, whiteSpace: 'nowrap', flexShrink: 0 }}>
              Nueva ruta
            </a>
          )}
          <span
            data-testid="session-email"
            title={me.email}
          >
            {me.email}
          </span>
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
