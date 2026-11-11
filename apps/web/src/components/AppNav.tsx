'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** The bottom nav (a row under the top bar from 720 px). `fab` is the server-rendered upload slot. */
export function AppNav({ fab }: { fab: ReactNode }) {
  const pathname = usePathname();
  const explore = pathname === '/' || pathname === '/mapa';
  return (
    <nav aria-label="Principal" className="bottom-nav">
      <a href="/" className="nav-item" aria-current={explore ? 'page' : undefined}>
        <Icon name="compass" />
        <span>Explorar</span>
      </a>
      {fab}
    </nav>
  );
}
