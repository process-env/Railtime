import { describe, it, expect } from 'vitest';
import { middleware, config } from './middleware';
import { NextRequest } from 'next/server';

describe('middleware', () => {
  describe('config', () => {
    it('exports a matcher for API routes', () => {
      expect(config).toBeDefined();
      expect(config.matcher).toBeDefined();
      expect(config.matcher).toContain('/api/:path*');
    });
  });

  describe('middleware function', () => {
    it('returns NextResponse.next() for API requests', () => {
      const request = new NextRequest(
        new URL('/api/v1/trains', 'http://localhost:3000')
      );

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
    });

    it('returns NextResponse.next() for nested API paths', () => {
      const request = new NextRequest(
        new URL('/api/v1/feed/ACE', 'http://localhost:3000')
      );

      const response = middleware(request);

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
    });
  });
});
