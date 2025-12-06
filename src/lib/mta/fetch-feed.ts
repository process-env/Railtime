import axios from 'axios';
import type { FeedEntity, StopUpdate } from '@/types/mta';
import { getGroupUrl } from './feed-groups';
import { loadStops } from './load-stops';
import { parseFeedBuffer, formatTimestamp } from './parse-feed';
import { getCache, setCache } from '../redis';

const CACHE_TTL_SECONDS = 15;

interface FetchFeedOptions {
  useCache?: boolean;
  apiKey?: string | null;
}

/**
 * Fetches and decodes a GTFS-Realtime feed for a feed group.
 */
export async function fetchFeed(
  groupId: string,
  options: FetchFeedOptions = {}
): Promise<FeedEntity[]> {
  const { useCache = true, apiKey: overrideApiKey = null } = options;

  const url = getGroupUrl(groupId);
  if (!url) {
    throw new Error(`Unknown feed group: ${groupId}`);
  }

  const cacheKey = `feed:${groupId}:latest`;

  // Try cache first
  if (useCache) {
    const cached = await getCache<FeedEntity[]>(cacheKey);
    if (cached) return cached;
  }

  // Fetch from MTA API
  const apiKey = overrideApiKey || process.env.MTA_API_KEY;
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    timeout: 15000,
  });

  // Decode protobuf
  const message = await parseFeedBuffer(resp.data);
  const messageObj = message.toJSON() as {
    header?: { timestamp?: number };
    entity?: Array<{
      id?: string;
      tripUpdate?: {
        trip?: {
          routeId?: string;
          tripId?: string;
          startDate?: string;
        };
        stopTimeUpdate?: Array<{
          stopId?: string;
          arrival?: { time?: number; delay?: number };
          departure?: { time?: number; delay?: number };
          scheduleRelationship?: string;
        }>;
      };
      vehicle?: {
        vehicle?: { id?: string };
      };
    }>;
  };

  // Load stops for name resolution
  const { dict: stopDict } = await loadStops();

  // Simplify entities
  const result: FeedEntity[] = [];

  for (const ent of messageObj.entity || []) {
    if (!ent.tripUpdate) continue;

    const tu = ent.tripUpdate;
    const routeId = tu.trip?.routeId || null;
    const tripId = tu.trip?.tripId || null;
    const startDate = tu.trip?.startDate || null;
    const vehicleId = ent.vehicle?.vehicle?.id || null;

    const stopUpdates: StopUpdate[] = [];

    for (const stu of tu.stopTimeUpdate || []) {
      const sId = stu.stopId || null;
      stopUpdates.push({
        stopId: sId,
        stopName: sId && stopDict[sId]?.name || null,
        arrival: {
          time: formatTimestamp(stu.arrival?.time),
          delay: stu.arrival?.delay ?? null,
        },
        departure: {
          time: formatTimestamp(stu.departure?.time),
          delay: stu.departure?.delay ?? null,
        },
        scheduleRelationship: stu.scheduleRelationship || null,
      });
    }

    result.push({
      id: ent.id || null,
      routeId,
      tripId,
      startDate,
      vehicleId,
      stopUpdates,
      timestamp: messageObj.header?.timestamp
        ? formatTimestamp(messageObj.header.timestamp)
        : null,
    });
  }

  // Cache result
  if (useCache) {
    await setCache(cacheKey, result, CACHE_TTL_SECONDS);
  }

  return result;
}

/**
 * Fetch all feeds and combine results.
 */
export async function fetchAllFeeds(
  options: FetchFeedOptions = {}
): Promise<FeedEntity[]> {
  const groupIds = ['ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SI', '1234567'];

  const results = await Promise.all(
    groupIds.map((groupId) =>
      fetchFeed(groupId, options).catch((err) => {
        console.error(`Error fetching ${groupId}:`, err.message);
        return [] as FeedEntity[];
      })
    )
  );

  return results.flat();
}
