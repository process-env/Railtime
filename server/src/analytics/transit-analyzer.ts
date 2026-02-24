/**
 * Transit Analyzer — generates AI-powered insights from flush data.
 *
 * Called by the metrics-collector after each 5-minute flush.
 * Uses OpenAI GPT-4.1 to find non-obvious patterns
 * in the raw metrics, then caches the result in Redis.
 */
import OpenAI from 'openai';
import { getCache, setCache } from '../lib/redis.js';
import { CACHE_KEYS } from '../lib/cache.js';
import { createLogger } from '../lib/logger.js';
import type { AlertSummary } from '../types.js';
import { writeEvents } from './dynamodb-writer.js';
import type { MetricRecord, EventRecord, RollupRecord } from './dynamodb-writer.js';

const log = createLogger('analyzer');

const MODEL_ID = 'gpt-4.1';
const CACHE_MODEL_NAME = 'gpt-4.1';
const CACHE_TTL_SECONDS = 600; // 10 minutes (2x flush interval for safety)

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

async function callModel(prompt: string): Promise<{ text: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.error('OPENAI_API_KEY not set');
    return null;
  }
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: MODEL_ID,
    max_tokens: 1024,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.choices[0]?.message?.content ?? '';
  if (!text) {
    log.warn('empty response from OpenAI');
    return null;
  }
  return { text };
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
      model: MODEL_ID,
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
      { model: MODEL_ID, charCount: result.text.length },
      'analysis generated and cached',
    );
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'failed to generate analysis');
  }
}
