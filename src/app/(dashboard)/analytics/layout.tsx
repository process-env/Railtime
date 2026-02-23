'use client';

import { ApolloProvider } from '@/components/providers/ApolloProvider';

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ApolloProvider>{children}</ApolloProvider>;
}
