'use client';

import { useState } from 'react';
import { signOut } from '../../lib/auth-client';
import { MESSAGES } from '../../lib/auth-errors';

export function SignOutButton() {
  const [failed, setFailed] = useState(false);

  async function onClick() {
    const result = await signOut();
    if (!result.ok) return setFailed(true);
    window.location.assign('/');
  }

  return (
    <>
      <button type="button" onClick={() => void onClick()} className="link-button">
        Salir
      </button>
      {failed && <span role="alert">{MESSAGES.generic}</span>}
    </>
  );
}
