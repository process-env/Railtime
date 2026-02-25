import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { SocketProvider } from '@/components/providers/SocketProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MTA Subway Tracker',
  description: 'Real-time NYC subway train tracking dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preconnect to map tile servers for faster LCP */}
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://tiles.basemaps.cartocdn.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://basemaps.cartocdn.com" />
        <link rel="dns-prefetch" href="https://tiles.basemaps.cartocdn.com" />
        {/* Map preloads moved to (dashboard)/map/layout.tsx to avoid warnings on non-map pages */}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>
          <SocketProvider>
            {children}
          </SocketProvider>
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
