'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** A nav link that marks itself with aria-current on its own page. */
export function NavLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const current = usePathname() === href;
  return (
    <a href={href} className={className} aria-current={current ? 'page' : undefined}>
      {children}
    </a>
  );
}
