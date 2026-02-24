import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config';

describe('next.config.ts', () => {
  describe('cache headers', () => {
    it('defines headers as an async function', () => {
      expect(nextConfig.headers).toBeDefined();
      expect(typeof nextConfig.headers).toBe('function');
    });

    it('returns cache headers for static data JSON files', async () => {
      const headers = await nextConfig.headers!();

      expect(headers.length).toBeGreaterThan(0);

      const dataRule = headers.find((h) => h.source.includes('/data/'));
      expect(dataRule).toBeDefined();
      expect(dataRule!.source).toBe('/data/:path*.json');
    });

    it('sets sensible Cache-Control values on static data', async () => {
      const headers = await nextConfig.headers!();
      const dataRule = headers.find((h) => h.source.includes('/data/'));
      expect(dataRule).toBeDefined();

      const cacheControl = dataRule!.headers.find(
        (h) => h.key === 'Cache-Control'
      );
      expect(cacheControl).toBeDefined();

      const value = cacheControl!.value;

      // Must include public directive
      expect(value).toContain('public');

      // max-age should be positive (at least 1 hour = 3600)
      const maxAgeMatch = value.match(/max-age=(\d+)/);
      expect(maxAgeMatch).not.toBeNull();
      const maxAge = parseInt(maxAgeMatch![1], 10);
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeGreaterThanOrEqual(3600);

      // stale-while-revalidate should be positive
      const swrMatch = value.match(/stale-while-revalidate=(\d+)/);
      expect(swrMatch).not.toBeNull();
      const swr = parseInt(swrMatch![1], 10);
      expect(swr).toBeGreaterThan(0);

      // stale-while-revalidate should be longer than max-age
      expect(swr).toBeGreaterThan(maxAge);
    });
  });
});
