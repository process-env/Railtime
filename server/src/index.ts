import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { getPubClient, getSubClient, closeAll as closeRedis } from "./lib/redis.js";
import { closeDriver as closeNeo4j } from "./lib/neo4j.js";
import { closeDynamoClient } from "./lib/dynamodb.js";
import { startFeedLoop, stopFeedLoop } from "./ingestion/feed-loop.js";
import { startAlertLoop, stopAlertLoop } from "./ingestion/alert-loop.js";
import { broadcastArrivalsBatch } from "./namespaces/arrivals.js";
import { setupTrainsNamespace } from "./namespaces/trains.js";
import { setupAlertsNamespace } from "./namespaces/alerts.js";
import { setupArrivalsNamespace } from "./namespaces/arrivals.js";
import { handleTransitAnalysis } from "./api/transit-analysis.js";
import { handleAnomalyFeed } from "./api/anomaly-feed.js";
import type { FeedEntity } from "./types.js";
import { collectMetrics, collectAlertEvent, collectRemovedTrips, startCollector, stopCollector } from "./analytics/metrics-collector.js";
import { initScheduleLookup, stopScheduleLookup } from "./analytics/schedule-lookup.js";
import { createLogger } from "./lib/logger.js";
import { archivePositions, startArchiver, stopArchiver } from "./analytics/position-archiver.js";
import { closeS3Client } from "./lib/s3.js";

const log = createLogger('server');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const INSTANCE_ID = process.env.INSTANCE_ID ?? randomUUID();

const allowedOrigins = [
  "http://localhost:3000",
  ...(process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
].filter(Boolean);

// ---------------------------------------------------------------------------
// HTTP server (health check endpoint)
// ---------------------------------------------------------------------------

const httpServer = createServer(async (req, res) => {
  // CORS headers for all responses
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost`);

  if (url.pathname === "/api/transit-analysis") {
    await handleTransitAnalysis(req, res);
    return;
  }

  if (url.pathname === "/api/anomaly-feed") {
    await handleAnomalyFeed(req, res);
    return;
  }

  // Default: health check
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      service: "railtime-ws-server",
      instanceId: INSTANCE_ID,
      uptime: process.uptime(),
    }),
  );
});

// ---------------------------------------------------------------------------
// Socket.IO server
// ---------------------------------------------------------------------------

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

// ---------------------------------------------------------------------------
// Redis adapter (optional — gracefully degrades without Redis)
// ---------------------------------------------------------------------------

async function attachRedisAdapter(): Promise<boolean> {
  const pub = getPubClient();
  const sub = getSubClient();

  if (!pub || !sub) {
    log.warn('redis adapter unavailable — single-instance mode');
    return false;
  }

  try {
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    log.info('redis adapter attached (multi-instance ready)');
    return true;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'redis adapter setup failed, continuing without it');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Root namespace (basic connectivity)
// ---------------------------------------------------------------------------

io.on("connection", (socket) => {
  log.info({ socketId: socket.id }, 'client connected');
  socket.on("disconnect", (reason) => {
    log.info({ socketId: socket.id, reason }, 'client disconnected');
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string) {
  log.info({ signal }, 'received shutdown signal, shutting down gracefully');

  // Stop ingestion loops first (no more data flowing)
  stopFeedLoop();
  stopAlertLoop();

  // Flush remaining analytics data
  await stopCollector();

  // Flush remaining position data to S3
  await stopArchiver();

  // Stop schedule rebuild timer
  stopScheduleLookup();

  io.close(() => {
    log.info('socket.io server closed');
    httpServer.close(async () => {
      log.info('http server closed');

      // Close external connections
      await Promise.allSettled([closeRedis(), closeNeo4j(), closeDynamoClient(), closeS3Client()]);
      log.info('external connections closed');

      process.exit(0);
    });
  });

  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    log.fatal('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection — exiting');
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  log.fatal({ err: err.message, stack: err.stack }, 'uncaught exception — exiting');
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, async () => {
  log.info({ port: PORT, instanceId: INSTANCE_ID }, 'railtime ws server listening — single-instance mode (see SCALING.md)');
  log.info({ origins: allowedOrigins }, 'CORS origins configured');

  // Attach Redis adapter (non-blocking — continues without it)
  await attachRedisAdapter();

  // Set up namespaces
  const onTrainUpdate = setupTrainsNamespace(io);
  const onAlertUpdate = setupAlertsNamespace(io);
  setupArrivalsNamespace(io);

  // Load GTFS static schedule for delay computation (before feed loop starts)
  await initScheduleLookup();

  // Start ingestion loops
  startFeedLoop(
    // Per-group callback: trains, analytics, archiving
    (feedGroupId, trains, removedTripIds, entities, latencyMs, status) => {
      // Forward to /trains namespace
      onTrainUpdate(feedGroupId, trains, removedTripIds, entities, latencyMs, status);

      // Forward to analytics collector (DynamoDB persistence)
      collectMetrics(feedGroupId, trains, entities as FeedEntity[], latencyMs, status);

      // Track trip lifecycle (TRIP_END events for removed trains)
      collectRemovedTrips(feedGroupId, removedTripIds);

      // Archive raw positions to S3 for ML pipeline
      archivePositions(feedGroupId, trains);
    },
    // Cycle-complete callback: batched arrival broadcast (STRAT-10)
    // Merges all feed groups' arrivals into a single broadcast per station,
    // so clients receive one complete update instead of up to 8 partial ones.
    (results) => {
      const allEntities = new Map<string, FeedEntity[]>();
      for (const r of results) {
        if (r.status === "success" && r.entities.length > 0) {
          allEntities.set(r.feedGroupId, r.entities as FeedEntity[]);
        }
      }
      if (allEntities.size > 0) {
        broadcastArrivalsBatch(allEntities);
      }
    },
  );

  startAlertLoop((alerts) => {
    onAlertUpdate(alerts);
    collectAlertEvent(alerts);
  });

  // Start analytics collector (flushes to DynamoDB every 5 min)
  startCollector();

  // Start position archiver (flushes to S3 every 60s)
  startArchiver();

  log.info('all namespaces and ingestion loops started');
});

export { io, httpServer };
