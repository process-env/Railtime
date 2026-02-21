'use client';

import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client';

const APPSYNC_URL = process.env.NEXT_PUBLIC_APPSYNC_URL ?? '';
const APPSYNC_API_KEY = process.env.NEXT_PUBLIC_APPSYNC_API_KEY ?? '';

const authLink = new ApolloLink((operation, forward) => {
  operation.setContext({
    headers: {
      'x-api-key': APPSYNC_API_KEY,
    },
  });
  return forward(operation);
});

const httpLink = new HttpLink({
  uri: APPSYNC_URL,
});

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          getRouteMetrics: {
            keyArgs: ['routeId'],
            merge(_existing = [], incoming: unknown[]) {
              return [...incoming];
            },
          },
          getDailyRollups: {
            keyArgs: ['routeId'],
            merge(_existing = [], incoming: unknown[]) {
              return [...incoming];
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
});
