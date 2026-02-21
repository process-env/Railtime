import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { SocketProvider } from '@/components/providers/SocketProvider';
import { ApolloProvider } from '@/components/providers/ApolloProvider';

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
        {/* Preload map style JSON — starts download before MapLibre initializes */}
        <link
          rel="preload"
          href="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          as="fetch"
          crossOrigin="anonymous"
        />
        {/* Preload subway lines GeoJSON — starts download before map.on('load') */}
        <link
          rel="preload"
          href="/map/nyc-subway-lines.geojson"
          as="fetch"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>
          <SocketProvider>
            <ApolloProvider>{children}</ApolloProvider>
          </SocketProvider>
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
