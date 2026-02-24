/**
 * Transit Analyzer — generates AI-powered insights from flush data.
 *
 * Called by the metrics-collector after each 5-minute flush.
 * Uses Claude Sonnet 4 on Bedrock to find non-obvious patterns
 * in the raw metrics, then caches the result in Redis.
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import Anthropic from '@anthropic-ai/sdk';
import { getCache, setCache } from '../lib/redis.js';
import { CACHE_KEYS } from '../lib/cache.js';
import { createLogger } from '../lib/logger.js';
import type { AlertSummary } from '../types.js';
import { writeEvents } from './dynamodb-writer.js';
import type { MetricRecord, EventRecord, RollupRecord } from './dynamodb-writer.js';

const log = createLogger('analyzer');

const BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';
const DIRECT_MODEL_ID = 'claude-sonnet-4-20250514';
const CACHE_MODEL_NAME = 'claude-sonnet-4';
const CACHE_TTL_SECONDS = 600; // 10 minutes (2x flush interval for safety)

let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }
  return bedrockClient;
}

export interface AnalysisInput {
  metrics: MetricRecord[];
  rollups: RollupRecord[];
  events: EventRecord[];
  alerts: AlertSummary[];
  systemHealth: (MetricRecord & { alertCount?: number | null }) | null;
}

export interface AnalysisResult {
  analysis: string;
  generatedAt: string;
  model: string;
}

/** Convert seconds to minutes, rounded to 1 decimal place. */
function toMin(seconds: number | null | undefined): number | null {
  if (seconds == null) return null;
  return Math.round((seconds / 60) * 10) / 10;
}

function buildPrompt(input: AnalysisInput): string {
  // --- Pre-compute derived metrics ---

  const routeData = input.metrics
    .filter(m => m.routeId !== 'SYSTEM_HEALTH')
    .map(m => {
      const [route, dir] = m.routeId.split('#');
      return {
        route,
        dir: dir ?? 'X',
        trains: m.trainCount,
        delayMin: toMin(m.avgDelaySeconds),
        onTime: m.onTimePercent,
        headwayMin: toMin(m.headwayAvgSeconds),
        latencyMs: m.feedLatencyMs,
        status: m.feedStatus,
      };
    });

  // Detect direction imbalances (big difference between N and S for same route)
  const byRoute = new Map<string, typeof routeData>();
  for (const r of routeData) {
    const arr = byRoute.get(r.route) ?? [];
    arr.push(r);
    byRoute.set(r.route, arr);
  }

  const directionImbalances: string[] = [];
  for (const [route, dirs] of byRoute) {
    const n = dirs.find(d => d.dir === 'N');
    const s = dirs.find(d => d.dir === 'S');
    if (n && s && n.trains > 0 && s.trains > 0) {
      const ratio = Math.max(n.trains, s.trains) / Math.min(n.trains, s.trains);
      if (ratio > 1.5) {
        directionImbalances.push(`${route}: ${n.trains} northbound vs ${s.trains} southbound (${ratio.toFixed(1)}x imbalance)`);
      }
    }
  }

  // Anomaly events with minutes
  const anomalies = input.events
    .filter(e => e.pk.startsWith('BUNCH#') || e.pk.startsWith('GAP#') || e.pk.startsWith('DELAY#'))
    .map(e => ({
      type: e.pk.split('#')[0],
      route: e.pk.split('#').slice(1).join('#'),
      detail: e.description ?? `${toMin(e.delaySeconds ?? 0)} min delay`,
    }));

  // Group anomalies by route to spot cascading issues
  const anomalyByRoute = new Map<string, string[]>();
  for (const a of anomalies) {
    const route = a.route.split('#')[0];
    const arr = anomalyByRoute.get(route) ?? [];
    arr.push(`${a.type}: ${a.detail}`);
    anomalyByRoute.set(route, arr);
  }
  const cascadingRoutes = Array.from(anomalyByRoute.entries())
    .filter(([, events]) => events.length >= 2)
    .map(([route, events]) => `${route}: ${events.join('; ')}`);

  // Daily rollup with minutes
  const rollupSummary = input.rollups.map(r => ({
    route: r.routeId,
    dir: r.direction,
    delayMin: toMin(r.avgDelay),
    onTime: r.onTimePercent,
    peakTrains: r.peakTrainCount,
    bunching: r.totalBunching,
    gaps: r.totalGaps,
    skipped: r.totalSkippedStops,
    trips: r.totalTrips,
  }));

  // Routes running ahead of schedule (negative delay = disruptive for connections)
  const aheadOfSchedule = routeData
    .filter(r => r.delayMin != null && r.delayMin < -0.5)
    .map(r => `${r.route}(${r.dir}): ${r.delayMin} min`);

  // System health
  const health = input.systemHealth ? {
    totalTrains: input.systemHealth.trainCount,
    feedStatus: input.systemHealth.feedStatus,
    avgLatencyMs: input.systemHealth.feedLatencyMs,
    alerts: input.systemHealth?.alertCount ?? 0,
  } : null;

  // Alert text
  const alerts = input.alerts.map(a => ({
    routes: a.affectedRoutes.join(', '),
    text: a.headerText.slice(0, 150),
  }));

  // --- Build the prompt ---

  return `You are a senior transit data analyst for NYC subway. All delay and headway values are in MINUTES. Extract non-obvious insights only — the dashboard already shows raw metrics.

## System: ${health ? `${health.totalTrains} trains, ${health.feedStatus}, ${health.alerts} alerts, ${health.avgLatencyMs}ms feed latency` : 'Unavailable'}

## Per-Route (5-min window, times in minutes)
${JSON.stringify(routeData)}

## Daily Totals
${JSON.stringify(rollupSummary)}

## Pre-Computed Signals
Direction imbalances: ${directionImbalances.length > 0 ? directionImbalances.join('; ') : 'None'}
Cascading anomalies: ${cascadingRoutes.length > 0 ? cascadingRoutes.join('; ') : 'None'}
Ahead of schedule: ${aheadOfSchedule.length > 0 ? aheadOfSchedule.join('; ') : 'None'}
Anomaly events: ${anomalies.length > 0 ? JSON.stringify(anomalies) : 'None'}

## Alerts (${alerts.length})
${alerts.length > 0 ? JSON.stringify(alerts) : 'None'}

## Task
Write 3-5 bullet points of NON-OBVIOUS insights. Each bullet MUST start with a **bold summary phrase** followed by a colon and the detailed explanation. Connect multiple data points. Use minutes for all times. Be specific with route letters/numbers.

Format: - **Bold summary phrase**: detailed explanation connecting data points...

Examples of good insights:
- **Route 4 terminal congestion causing bunching cascade**: despite near-perfect on-time performance, the 2.3x directional imbalance and 379 bunching incidents suggest Brooklyn Bridge terminal delays are compressing headways
- **Alert-delay disconnect on Q line**: 3 active alerts but actual delays remain under 2 min, indicating precautionary alerts rather than service impact

Do NOT restate raw numbers, list best/worst routes, or give generic rider advice.`;
}

/**
 * Try Bedrock first. If access is revoked, fall back to Anthropic direct API.
 * Returns the analysis text or null if both fail.
 */
async function callModel(prompt: string): Promise<{ text: string; source: 'bedrock' | 'direct' } | null> {
  // --- Attempt 1: AWS Bedrock ---
  try {
    const client = getBedrockClient();
    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body),
    );
    const text: string = responseBody.content?.[0]?.text ?? '';
    if (!text) {
      log.warn('empty response from Bedrock');
      return null;
    }
    return { text, source: 'bedrock' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAccessError = message.includes('not allowed') || message.includes('Access');

    if (!isAccessError) {
      // Non-access error — don't retry with direct API
      log.error({ err: message }, 'Bedrock call failed (non-access error)');
      return null;
    }

    log.warn({ err: message }, 'Bedrock access denied, falling back to Anthropic direct API');
  }

  // --- Attempt 2: Anthropic Direct API ---
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error('ANTHROPIC_API_KEY not set — cannot fall back to direct API');
    return null;
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: DIRECT_MODEL_ID,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    if (!text) {
      log.warn('empty response from Anthropic direct API');
      return null;
    }
    return { text, source: 'direct' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'Anthropic direct API call failed');
    return null;
  }
}

/**
 * Generate transit analysis and cache it.
 * Called by metrics-collector after each successful flush.
 * Runs async — errors are logged but don't break the flush cycle.
 */
export async function generateAnalysis(input: AnalysisInput): Promise<void> {
  try {
    const prompt = buildPrompt(input);

    const result = await callModel(prompt);
    if (!result) return;

    const analysisResult: AnalysisResult = {
      analysis: result.text,
      generatedAt: new Date().toISOString(),
      model: CACHE_MODEL_NAME,
    };

    await setCache(CACHE_KEYS.transitAnalysis, analysisResult, CACHE_TTL_SECONDS);

    // Persist analysis to DynamoDB for long-term archival (flows to S3 via DynamoDB Streams)
    writeEvents([{
      pk: 'ANALYSIS#SYSTEM',
      timestamp: Date.now(),
      description: JSON.stringify(analysisResult),
      expireAt: Math.floor(Date.now() / 1000) + 365 * 86400,
    }]).catch(err =>
      log.error({ err: err instanceof Error ? err.message : err }, 'failed to persist analysis'),
    );

    log.info(
      { model: CACHE_MODEL_NAME, source: result.source, charCount: result.text.length },
      'analysis generated and cached',
    );
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'failed to generate analysis');
  }
}
