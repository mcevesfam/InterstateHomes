import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RoleProvider } from '@/lib/role-context';
import { PageContextProvider } from '@/lib/page-context';
import { AppShell } from '@/components/AppShell';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111111',
};

export const metadata: Metadata = {
  title: 'Interstate Homes — Estimating, Subcontract & Budget Software',
  description:
    'Internal estimating, subcontractor compliance, purchase orders, and live job cost budget platform for Interstate Homes.',
  appleWebApp: {
    capable: true,
    title: 'Interstate Homes',
    statusBarStyle: 'black-translucent',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&family=Nunito+Sans:wght@400;600;700&display=swap"
        />
      </head>
      <body>
        <RoleProvider>
          <PageContextProvider>
            <AppShell>{children}</AppShell>
          </PageContextProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
