/**
 * Simple in-memory rate limiter for API routes
 *
 * Uses sliding window algorithm with generous defaults to avoid
 * breaking the app's frequent polling behavior.
 *
 * Default limits per endpoint type:
 * - Real-time data (trains, arrivals): 120 req/min (2/sec)
 * - Static data (stops, routes): 60 req/min
 * - Admin/cron: 10 req/min
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (resets on server restart)
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetIn: number;
}

// Preset configurations
export const RATE_LIMITS = {
  // Real-time endpoints (trains, arrivals, feed) - high frequency
  realtime: { limit: 120, windowMs: 60 * 1000 }, // 120/min

  // Static data endpoints (stops, routes) - moderate
  static: { limit: 60, windowMs: 60 * 1000 }, // 60/min

  // Search endpoints - moderate with burst protection
  search: { limit: 30, windowMs: 60 * 1000 }, // 30/min

  // Admin/cron endpoints - strict
  admin: { limit: 10, windowMs: 60 * 1000 }, // 10/min

  // Analytics endpoints - lenient
  analytics: { limit: 60, windowMs: 60 * 1000 }, // 60/min
} as const;

/**
 * Check rate limit for a given identifier
 * @param identifier Unique key (e.g., IP + endpoint)
 * @param config Rate limit configuration
 * @returns Result with success status and remaining quota
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const entry = store.get(identifier);

  // No existing entry or window expired
  if (!entry || now > entry.resetTime) {
    store.set(identifier, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      success: true,
      remaining: config.limit - 1,
      resetIn: config.windowMs,
    };
  }

  // Within window
  if (entry.count >= config.limit) {
    return {
      success: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    };
  }

  entry.count++;
  return {
    success: true,
    remaining: config.limit - entry.count,
    resetIn: entry.resetTime - now,
  };
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For header (for proxies) or falls back to a default
 */
export function getClientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback for development
  return 'localhost';
}

/**
 * Create rate limit key from client ID and endpoint
 */
export function createRateLimitKey(clientId: string, endpoint: string): string {
  return `${clientId}:${endpoint}`;
}
