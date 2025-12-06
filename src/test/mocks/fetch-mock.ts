import { vi } from 'vitest';

type MockResponse<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
};

type MockError = {
  error: string;
  status?: number;
};

// Store for mock responses
const mockResponses = new Map<string, MockResponse<unknown> | MockError>();

/**
 * Mock a successful API response
 */
export function mockApiResponse<T>(
  urlPattern: string,
  data: T,
  status = 200,
  headers: Record<string, string> = {}
): void {
  mockResponses.set(urlPattern, { data, status, headers });
}

/**
 * Mock an API error response
 */
export function mockApiError(
  urlPattern: string,
  error: string,
  status = 500
): void {
  mockResponses.set(urlPattern, { error, status });
}

/**
 * Clear all mock responses
 */
export function clearApiMocks(): void {
  mockResponses.clear();
}

/**
 * Get mock response for a URL
 */
function getMockForUrl(url: string): MockResponse<unknown> | MockError | undefined {
  // Exact match first
  if (mockResponses.has(url)) {
    return mockResponses.get(url);
  }

  // Pattern match (simple glob-like)
  for (const [pattern, response] of mockResponses.entries()) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(url)) {
        return response;
      }
    }
  }

  return undefined;
}

/**
 * Create a mock fetch implementation
 */
export function createMockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const mock = getMockForUrl(url);

    if (!mock) {
      return new Response(JSON.stringify({ error: 'No mock for ' + url }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if ('error' in mock) {
      return new Response(JSON.stringify({ error: mock.error }), {
        status: mock.status || 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(mock.data), {
      status: mock.status || 200,
      headers: {
        'Content-Type': 'application/json',
        ...mock.headers,
      },
    });
  });
}

/**
 * Setup fetch mock for tests
 */
export function setupFetchMock() {
  const mockFetch = createMockFetch();
  global.fetch = mockFetch;
  return mockFetch;
}

/**
 * Create a mock Response object
 */
export function createMockResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mock fetch to return specific data once
 */
export function mockFetchOnce<T>(data: T, status = 200) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    createMockResponse(data, status)
  );
}

/**
 * Mock fetch to reject with error once
 */
export function mockFetchErrorOnce(error: string) {
  (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error(error)
  );
}
