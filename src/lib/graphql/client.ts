'use client';

import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  HttpLink,
  Observable,
} from '@apollo/client';

const APPSYNC_URL = process.env.NEXT_PUBLIC_APPSYNC_URL ?? '';
const APPSYNC_API_KEY = process.env.NEXT_PUBLIC_APPSYNC_API_KEY ?? '';

/** When AppSync is not configured, short-circuit all requests. */
const noopLink = new ApolloLink(() => {
  return new Observable((observer) => {
    observer.next({ data: null });
    observer.complete();
  });
});

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

const link = APPSYNC_URL
  ? authLink.concat(httpLink)
  : noopLink;

export const apolloClient = new ApolloClient({
  link,
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
