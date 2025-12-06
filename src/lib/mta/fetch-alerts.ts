import axios from 'axios';
import type { ServiceAlert, AlertSeverity } from '@/types/mta';
import { getCache, setCache } from '../redis';
import { ALL_ROUTES } from '../constants';
import { loadStops } from './load-stops';

const ALERTS_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts.json';
const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = 'alerts:all';

// Subway routes to filter (exclude bus routes like M101)
const SUBWAY_ROUTES = new Set(ALL_ROUTES);

// Map MTA alert types to severity
const SEVERITY_MAP: Record<string, AlertSeverity> = {
  Delays: 'warning',
  'Service Change': 'warning',
  Detour: 'warning',
  Suspension: 'critical',
  Cancellations: 'critical',
  'Planned Work': 'info',
  Information: 'info',
  'Station Notice': 'info',
};

interface MtaAlertEntity {
  id: string;
  alert?: {
    active_period?: Array<{ start?: number; end?: number }>;
    informed_entity?: Array<{
      agency_id?: string;
      route_id?: string;
      stop_id?: string;
    }>;
    header_text?: {
      translation?: Array<{ text?: string; language?: string }>;
    };
    description_text?: {
      translation?: Array<{ text?: string; language?: string }>;
    };
  };
  'transit_realtime.mercury_alert'?: {
    alert_type?: string;
    created_at?: number;
    updated_at?: number;
  };
}

interface MtaAlertsResponse {
  header?: { timestamp?: number };
  entity?: MtaAlertEntity[];
}

interface FetchAlertsOptions {
  useCache?: boolean;
}

/**
 * Extract text from translation array, preferring HTML version
 */
function extractText(
  translations?: Array<{ text?: string; language?: string }>,
  preferHtml = false
): string {
  if (!translations?.length) return '';

  const htmlVersion = translations.find((t) => t.language === 'en-html');
  const plainVersion = translations.find((t) => t.language === 'en');

  if (preferHtml && htmlVersion?.text) return htmlVersion.text;
  return plainVersion?.text || htmlVersion?.text || translations[0]?.text || '';
}

/**
 * Extract subway route IDs from informed entities
 */
function extractSubwayRoutes(
  entities?: Array<{ route_id?: string }>
): string[] {
  if (!entities?.length) return [];

  return entities
    .map((e) => e.route_id?.toUpperCase())
    .filter((r): r is string => !!r && SUBWAY_ROUTES.has(r));
}

/**
 * Extract stop IDs from informed entities
 */
function extractStops(entities?: Array<{ stop_id?: string }>): string[] {
  if (!entities?.length) return [];

  return entities
    .map((e) => e.stop_id)
    .filter((s): s is string => !!s);
}

/**
 * Convert Unix timestamp to ISO string
 */
function toIsoString(timestamp?: number): string {
  if (!timestamp) return new Date().toISOString();
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Get severity from alert type
 */
function getSeverity(alertType?: string): AlertSeverity {
  if (!alertType) return 'info';
  return SEVERITY_MAP[alertType] || 'info';
}

/**
 * Resolve stop IDs to station names
 */
async function resolveStopNames(stopIds: string[]): Promise<string[]> {
  if (!stopIds.length) return [];

  const { dict, parentNames } = await loadStops();
  const names: string[] = [];

  for (const stopId of stopIds) {
    const stop = dict[stopId];
    if (stop) {
      // Use parent station name if available, otherwise use stop name
      const name = stop.parent ? parentNames[stop.parent] || stop.name : stop.name;
      if (!names.includes(name)) {
        names.push(name);
      }
    } else {
      // Fallback to raw ID if not found
      if (!names.includes(stopId)) {
        names.push(stopId);
      }
    }
  }

  return names;
}

/**
 * Fetches and parses MTA service alerts
 */
export async function fetchAlerts(
  options: FetchAlertsOptions = {}
): Promise<ServiceAlert[]> {
  const { useCache = true } = options;

  // Try cache first
  if (useCache) {
    const cached = await getCache<ServiceAlert[]>(CACHE_KEY);
    if (cached) return cached;
  }

  // Fetch from MTA API
  const resp = await axios.get<MtaAlertsResponse>(ALERTS_URL, {
    timeout: 15000,
  });

  const entities = resp.data.entity || [];
  const alerts: ServiceAlert[] = [];

  for (const entity of entities) {
    if (!entity.alert) continue;

    const alert = entity.alert;
    const mercury = entity['transit_realtime.mercury_alert'];

    // Extract subway routes - skip alerts that don't affect subway
    const affectedRoutes = extractSubwayRoutes(alert.informed_entity);
    if (affectedRoutes.length === 0) continue;

    const alertType = mercury?.alert_type || 'Information';
    const headerText = extractText(alert.header_text?.translation, false);
    const descriptionHtml = extractText(alert.description_text?.translation, true);

    // Parse active periods
    const activePeriods = (alert.active_period || []).map((p) => ({
      start: toIsoString(p.start),
      end: p.end ? toIsoString(p.end) : undefined,
    }));

    const affectedStops = extractStops(alert.informed_entity);
    const affectedStopNames = await resolveStopNames(affectedStops);

    alerts.push({
      id: entity.id,
      alertType,
      severity: getSeverity(alertType),
      headerText,
      descriptionHtml,
      affectedRoutes,
      affectedStops,
      affectedStopNames,
      activePeriods,
      createdAt: toIsoString(mercury?.created_at),
      updatedAt: toIsoString(mercury?.updated_at),
    });
  }

  // Sort by severity (critical first) then by updated time
  const severityOrder: Record<AlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  alerts.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  // Cache result
  if (useCache) {
    await setCache(CACHE_KEY, alerts, CACHE_TTL_SECONDS);
  }

  return alerts;
}

/**
 * Filter alerts by route IDs
 */
export function filterAlertsByRoutes(
  alerts: ServiceAlert[],
  routeIds: string[]
): ServiceAlert[] {
  if (!routeIds.length) return alerts;

  const routeSet = new Set(routeIds.map((r) => r.toUpperCase()));
  return alerts.filter((a) =>
    a.affectedRoutes.some((r) => routeSet.has(r))
  );
}
