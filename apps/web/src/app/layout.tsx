import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Ciudad Enduro',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-PE">
      <body style={{ margin: 0, background: '#0A0A0A', color: '#F5F5F5', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
