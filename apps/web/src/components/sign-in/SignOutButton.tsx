'use client';

import { useState } from 'react';
import { signOut } from '../../lib/auth-client';
import { MESSAGES } from '../../lib/auth-errors';
import { linkButton } from './styles';

export function SignOutButton() {
  const [failed, setFailed] = useState(false);

  async function onClick() {
    const result = await signOut();
    if (!result.ok) return setFailed(true);
    window.location.assign('/');
  }

  return (
    <>
      <button type="button" onClick={() => void onClick()} style={linkButton}>
        Salir
      </button>
      {failed && <span role="alert">{MESSAGES.generic}</span>}
    </>
  );
}
