/**
 * Transit Analysis API endpoint.
 *
 * Reads the latest per-route metrics and service alerts from DynamoDB,
 * sends them to Amazon Bedrock Nova Micro for AI analysis, caches the
 * result in Redis (10 min TTL), and returns it as JSON.
 *
 * GET /api/transit-analysis
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { getDynamoClient } from '../lib/dynamodb.js';
import { getCache, setCache } from '../lib/redis.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const METRICS_TABLE =
  process.env.DYNAMODB_TABLE_METRICS ?? 'railtime-metrics';
const EVENTS_TABLE =
  process.env.DYNAMODB_TABLE_EVENTS ?? 'railtime-events';
const CACHE_KEY = 'transit-analysis:latest';
const CACHE_TTL_SECONDS = 600; // 10 minutes
const MODEL_ID = 'amazon.nova-micro-v1:0';

// ---------------------------------------------------------------------------
// Bedrock client (lazy singleton)
// ---------------------------------------------------------------------------

let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }
  return bedrockClient;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// DynamoDB data fetchers
// ---------------------------------------------------------------------------

interface RouteMetric {
  routeId: string;
  trainCount: number;
  avgDelaySeconds: number | null;
  onTimePercent: number | null;
  headwayAvgSeconds: number | null;
  feedStatus: string;
}

interface AlertEvent {
  routeId: string;
  severity: string | undefined;
  description: string | undefined;
  alertId: string | undefined;
}

/**
 * Fetch per-route metrics from the last 10 minutes.
 * Uses a Scan with filter on timestamp (table is small due to 7-day TTL).
 */
async function fetchRecentMetrics(): Promise<RouteMetric[]> {
  const client = getDynamoClient();
  if (!client) return [];

  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

  const result = await client.send(
    new ScanCommand({
      TableName: METRICS_TABLE,
      FilterExpression:
        '#ts >= :since AND routeId <> :systemHealth',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':since': tenMinutesAgo,
        ':systemHealth': 'SYSTEM_HEALTH',
      },
    }),
  );

  if (!result.Items || result.Items.length === 0) return [];

  // Deduplicate: keep only the latest record per routeId
  const latestByRoute = new Map<string, Record<string, unknown>>();
  for (const item of result.Items) {
    const routeId = item.routeId as string;
    const ts = item.timestamp as number;
    const existing = latestByRoute.get(routeId);
    if (!existing || (existing.timestamp as number) < ts) {
      latestByRoute.set(routeId, item);
    }
  }

  return Array.from(latestByRoute.values()).map((item) => ({
    routeId: (item.routeId as string).split('#')[0], // strip direction suffix
    trainCount: (item.trainCount as number) ?? 0,
    avgDelaySeconds: (item.avgDelaySeconds as number) ?? null,
    onTimePercent: (item.onTimePercent as number) ?? null,
    headwayAvgSeconds: (item.headwayAvgSeconds as number) ?? null,
    feedStatus: (item.feedStatus as string) ?? 'unknown',
  }));
}

/**
 * Fetch active alert events from the last hour.
 */
async function fetchRecentAlerts(): Promise<AlertEvent[]> {
  const client = getDynamoClient();
  if (!client) return [];

  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  const result = await client.send(
    new ScanCommand({
      TableName: EVENTS_TABLE,
      FilterExpression:
        'begins_with(pk, :prefix) AND #ts > :since',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':prefix': 'ALERT#',
        ':since': oneHourAgo,
      },
    }),
  );

  if (!result.Items || result.Items.length === 0) return [];

  // Deduplicate by alertId (same alert may be written multiple times)
  const seenAlertIds = new Set<string>();
  const alerts: AlertEvent[] = [];

  for (const item of result.Items) {
    const alertId = item.alertId as string | undefined;
    if (alertId && seenAlertIds.has(alertId)) continue;
    if (alertId) seenAlertIds.add(alertId);

    const pk = item.pk as string;
    const routeId = pk.replace('ALERT#', '');

    alerts.push({
      routeId,
      severity: item.severity as string | undefined,
      description: item.description as string | undefined,
      alertId,
    });
  }

  return alerts;
}

/**
 * Fetch the SYSTEM_HEALTH summary record (latest one).
 */
async function fetchSystemHealth(): Promise<Record<string, unknown> | null> {
  const client = getDynamoClient();
  if (!client) return null;

  const result = await client.send(
    new QueryCommand({
      TableName: METRICS_TABLE,
      KeyConditionExpression: 'routeId = :pk',
      ExpressionAttributeValues: {
        ':pk': 'SYSTEM_HEALTH',
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  return result.Items?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Bedrock invocation
// ---------------------------------------------------------------------------

function buildPrompt(
  metrics: RouteMetric[],
  alerts: AlertEvent[],
  systemHealth: Record<string, unknown> | null,
): string {
  const systemSummary = systemHealth
    ? `Total active trains: ${systemHealth.trainCount ?? 'N/A'}, Feed status: ${systemHealth.feedStatus ?? 'N/A'}, Active alerts: ${systemHealth.alertCount ?? 0}`
    : 'System health data unavailable.';

  const metricsJson = metrics.map((m) => ({
    routeId: m.routeId,
    trainCount: m.trainCount,
    avgDelaySeconds: m.avgDelaySeconds,
    onTimePercent: m.onTimePercent,
    headwayAvg: m.headwayAvgSeconds,
  }));

  const alertsJson = alerts.map((a) => ({
    route: a.routeId,
    severity: a.severity ?? 'unknown',
    description: a.description ?? 'No description',
  }));

  return `You are a transit analyst for the NYC subway system. Analyze the following real-time data and provide a brief daily transit intelligence report.

## System Overview
${systemSummary}

## Current System Metrics (last 5 minutes)
${JSON.stringify(metricsJson, null, 2)}

## Active Service Alerts
${alertsJson.length > 0 ? JSON.stringify(alertsJson, null, 2) : 'No active alerts.'}

Provide a concise analysis with these sections:
1. **System Status** - One sentence overall health assessment
2. **Top Performers** - 2-3 routes running best and why
3. **Problem Areas** - 2-3 routes with issues and what's wrong
4. **Alert Impact** - How current alerts affect riders
5. **Rider Tip** - One actionable recommendation

Keep each section to 1-2 sentences. Be specific with route names and numbers.`;
}

async function invokeBedrockAnalysis(prompt: string): Promise<string> {
  const client = getBedrockClient();

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 512,
        temperature: 0.3,
      },
    }),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(
    new TextDecoder().decode(response.body),
  );
  const analysisText: string =
    responseBody.output?.message?.content?.[0]?.text ?? '';

  return analysisText;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleTransitAnalysis(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // 1. Check Redis cache
    const cached = await getCache<{
      analysis: string;
      generatedAt: string;
      model: string;
    }>(CACHE_KEY);

    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    // 2. Gather data from DynamoDB
    let metrics: RouteMetric[];
    let alerts: AlertEvent[];
    let systemHealth: Record<string, unknown> | null;

    try {
      [metrics, alerts, systemHealth] = await Promise.all([
        fetchRecentMetrics(),
        fetchRecentAlerts(),
        fetchSystemHealth(),
      ]);
    } catch (err) {
      console.error(
        '[transit-analysis] DynamoDB read failed:',
        err instanceof Error ? err.message : err,
      );
      sendJson(res, 503, {
        error: 'Data source unavailable',
        message: 'Failed to read metrics from DynamoDB',
      });
      return;
    }

    // 3. Build prompt and call Bedrock
    const prompt = buildPrompt(metrics, alerts, systemHealth);
    let analysisText: string;

    try {
      analysisText = await invokeBedrockAnalysis(prompt);
    } catch (err) {
      console.error(
        '[transit-analysis] Bedrock invocation failed:',
        err instanceof Error ? err.message : err,
      );
      sendJson(res, 502, {
        error: 'AI analysis unavailable',
        message: 'Failed to generate analysis from Bedrock',
      });
      return;
    }

    // 4. Build response
    const result = {
      analysis: analysisText,
      generatedAt: new Date().toISOString(),
      model: MODEL_ID,
    };

    // 5. Cache in Redis
    await setCache(CACHE_KEY, result, CACHE_TTL_SECONDS);

    // 6. Return
    sendJson(res, 200, result);
  } catch (err) {
    console.error(
      '[transit-analysis] Unexpected error:',
      err instanceof Error ? err.message : err,
    );
    sendJson(res, 500, {
      error: 'Internal server error',
      message: 'An unexpected error occurred',
    });
  }
}
