import type { Metadata } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';
import { AppNav } from '../components/AppNav';
import { SessionHeader } from '../components/SessionHeader';
import { UserNavItems } from '../components/UserNavItems';
import './globals.css';

// Self-hosted at build time with a size-adjusted fallback: no layout shift, no request to Google.
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--font-bebas' });
const inter = Inter({ weight: ['400', '500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Ciudad Enduro',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-PE" className={`${bebas.variable} ${inter.variable}`}>
      <body>
        <SessionHeader />
        <AppNav
          user={
            <Suspense fallback={null}>
              <UserNavItems />
            </Suspense>
          }
        />
        {children}
      </body>
    </html>
  );
}
