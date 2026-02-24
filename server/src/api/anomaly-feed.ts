/**
 * Anomaly Feed API endpoint.
 *
 * Serves recent BUNCH/GAP/DELAY anomaly events from a Redis sorted set.
 * Events are pushed by the metrics-collector flush cycle (every 5 minutes).
 *
 * GET /api/anomaly-feed?limit=50&routeId=A&type=BUNCH
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRedisClient } from '../lib/redis.js';
import { CACHE_KEYS } from '../lib/cache.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('api:anomaly-feed');

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function handleAnomalyFeed(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(limitParam || 50, 1), 200);
    const routeIdFilter = url.searchParams.get('routeId');
    const typeFilter = url.searchParams.get('type')?.toUpperCase();

    const client = getRedisClient();
    if (!client) {
      sendJson(res, 200, { events: [], count: 0, source: 'unavailable' });
      return;
    }

    // Get all recent events (newest first)
    const raw = await client.zrevrangebyscore(
      CACHE_KEYS.anomalyFeed,
      '+inf',
      '-inf',
      'LIMIT',
      0,
      200,
    );

    let events = raw.map(entry => {
      try { return JSON.parse(entry); }
      catch { return null; }
    }).filter(Boolean);

    // Filter by type (BUNCH, GAP, DELAY)
    if (typeFilter) {
      events = events.filter((e: { pk: string }) => e.pk.startsWith(`${typeFilter}#`));
    }

    // Filter by routeId
    if (routeIdFilter) {
      events = events.filter((e: { pk: string }) => {
        const parts = e.pk.split('#');
        return parts[1] === routeIdFilter;
      });
    }

    // Apply limit
    events = events.slice(0, limit);

    sendJson(res, 200, { events, count: events.length });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'request error');
    sendJson(res, 500, { error: 'Internal server error' });
  }
}
