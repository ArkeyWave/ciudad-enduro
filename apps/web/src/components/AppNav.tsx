'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** The bottom nav (a row under the top bar from 720 px). `user` is the server-rendered signed-in slot. */
export function AppNav({ user }: { user: ReactNode }) {
  const pathname = usePathname();
  const explore = pathname === '/' || pathname === '/mapa';
  return (
    <nav aria-label="Principal" className="bottom-nav">
      <a href="/" className="nav-item nav-explore" aria-current={explore ? 'page' : undefined}>
        <Icon name="compass" />
        <span>Explorar</span>
      </a>
      {user}
    </nav>
  );
}
