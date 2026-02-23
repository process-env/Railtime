/**
 * MTA Service Alert Polling Loop
 *
 * Polls the MTA alerts JSON feed every 60 seconds, parses alerts into
 * a normalized ServiceAlert[], and invokes the onUpdate callback so
 * the /alerts namespace can broadcast changes.
 */
import axios from "axios";
import { setCache } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";
import type { ServiceAlert, AlertSeverity } from "../types.js";

const log = createLogger('alert-loop');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALERTS_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts.json";
const POLL_INTERVAL_MS = 60_000;
const REDIS_TTL_SECONDS = 90; // slightly longer than poll interval
const FETCH_TIMEOUT_MS = 15_000;

// Subway route IDs (to filter out bus alerts)
const SUBWAY_ROUTES = new Set([
  "1","2","3","4","5","6","6X","7","7X",
  "A","C","E","B","D","F","FX","M",
  "G","J","Z","L",
  "N","Q","R","W",
  "S","FS","GS","H","SI","SIR",
]);

// Map MTA alert types to severity
const SEVERITY_MAP: Record<string, AlertSeverity> = {
  Delays: "warning",
  "Service Change": "warning",
  Detour: "warning",
  Suspension: "critical",
  Cancellations: "critical",
  "Planned Work": "info",
  Information: "info",
  "Station Notice": "info",
};

// ---------------------------------------------------------------------------
// MTA response types (JSON format, not protobuf)
// ---------------------------------------------------------------------------

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
  "transit_realtime.mercury_alert"?: {
    alert_type?: string;
    created_at?: number;
    updated_at?: number;
  };
}

interface MtaAlertsResponse {
  header?: { timestamp?: number };
  entity?: MtaAlertEntity[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(
  translations?: Array<{ text?: string; language?: string }>,
  preferHtml = false,
): string {
  if (!translations?.length) return "";
  const html = translations.find((t) => t.language === "en-html");
  const plain = translations.find((t) => t.language === "en");
  if (preferHtml && html?.text) return html.text;
  return plain?.text || html?.text || translations[0]?.text || "";
}

function extractSubwayRoutes(
  entities?: Array<{ route_id?: string }>,
): string[] {
  if (!entities?.length) return [];
  return entities
    .map((e) => e.route_id?.toUpperCase())
    .filter((r): r is string => !!r && SUBWAY_ROUTES.has(r));
}

function extractStops(
  entities?: Array<{ stop_id?: string }>,
): string[] {
  if (!entities?.length) return [];
  return entities
    .map((e) => e.stop_id)
    .filter((s): s is string => !!s);
}

function toIsoString(timestamp?: number): string {
  if (!timestamp) return new Date().toISOString();
  return new Date(timestamp * 1000).toISOString();
}

function getSeverity(alertType?: string): AlertSeverity {
  if (!alertType) return "info";
  return SEVERITY_MAP[alertType] || "info";
}

// ---------------------------------------------------------------------------
// Parse MTA response into ServiceAlert[]
// ---------------------------------------------------------------------------

function parseAlerts(data: MtaAlertsResponse): ServiceAlert[] {
  const entities = data.entity || [];
  const alerts: ServiceAlert[] = [];

  for (const entity of entities) {
    if (!entity.alert) continue;

    const alert = entity.alert;
    const mercury = entity["transit_realtime.mercury_alert"];

    const affectedRoutes = extractSubwayRoutes(alert.informed_entity);
    if (affectedRoutes.length === 0) continue; // skip non-subway alerts

    const alertType = mercury?.alert_type || "Information";
    const headerText = extractText(alert.header_text?.translation, false);
    const descriptionHtml = extractText(
      alert.description_text?.translation,
      true,
    );

    const activePeriods = (alert.active_period || []).map((p) => ({
      start: toIsoString(p.start),
      end: p.end ? toIsoString(p.end) : undefined,
    }));

    const affectedStops = extractStops(alert.informed_entity);

    alerts.push({
      id: entity.id,
      alertType,
      severity: getSeverity(alertType),
      headerText,
      descriptionHtml,
      affectedRoutes,
      affectedStops,
      activePeriods,
      createdAt: toIsoString(mercury?.created_at),
      updatedAt: toIsoString(mercury?.updated_at),
    });
  }

  // Sort: critical first, then warning, then info; within same severity by updatedAt desc
  const severityOrder: Record<AlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  alerts.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });

  return alerts;
}

// ---------------------------------------------------------------------------
// Loop lifecycle
// ---------------------------------------------------------------------------

export type AlertUpdateCallback = (alerts: ServiceAlert[]) => void;

let loopTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let previousAlertIds = new Set<string>();

async function fetchAndProcess(
  onUpdate: AlertUpdateCallback,
): Promise<void> {
  try {
    const resp = await axios.get<MtaAlertsResponse>(ALERTS_URL, {
      timeout: FETCH_TIMEOUT_MS,
    });

    const alerts = parseAlerts(resp.data);

    // Cache in Redis
    await setCache("alerts:all", alerts, REDIS_TTL_SECONDS);

    // Detect new and cleared alerts
    const currentIds = new Set(alerts.map((a) => a.id));
    const newAlerts = alerts.filter((a) => !previousAlertIds.has(a.id));
    const clearedIds: string[] = [];
    for (const id of previousAlertIds) {
      if (!currentIds.has(id)) clearedIds.push(id);
    }
    previousAlertIds = currentIds;

    // Invoke callback with full alert list (namespace will diff as needed)
    onUpdate(alerts);

    log.info({ total: alerts.length, new: newAlerts.length, cleared: clearedIds.length }, 'alert cycle complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'fetch error');
  }
}

/**
 * Start the alert polling loop. Runs one cycle immediately, then every
 * POLL_INTERVAL_MS (60s).
 */
export function startAlertLoop(onUpdate: AlertUpdateCallback): void {
  if (running) {
    log.warn('already running');
    return;
  }

  running = true;
  log.info({ intervalMs: POLL_INTERVAL_MS }, 'starting alert polling');

  // Run immediately
  fetchAndProcess(onUpdate).catch((err) =>
    log.error({ err: err instanceof Error ? err.message : err }, 'initial fetch error'),
  );

  loopTimer = setInterval(() => {
    if (!running) return;
    fetchAndProcess(onUpdate).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'fetch error'),
    );
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the alert polling loop.
 */
export function stopAlertLoop(): void {
  if (!running) return;
  running = false;

  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }

  log.info('stopped');
}
