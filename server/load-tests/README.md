# k6 Load Tests -- Railtime WebSocket Server

## Prerequisites

1. [k6](https://k6.io/docs/get-started/installation/) installed
2. Local stack running:
   ```bash
   docker compose -f docker-compose.v2.yml --env-file .env.v2 up -d
   cd server && npm run dev
   ```

## Running

```bash
# Full suite (3 scenarios: ramp, sustained, spike -- ~16 min total)
k6 run server/load-tests/ws-load-test.js

# Quick smoke test (override scenarios)
k6 run --vus 10 --duration 30s server/load-tests/ws-load-test.js

# Against production
k6 run -e WS_URL=https://your-ws-server.com server/load-tests/ws-load-test.js

# Output to JSON for analysis
k6 run --out json=results.json server/load-tests/ws-load-test.js
```

## Scenarios

| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| `connection_ramp` | 0 -> 200 | 6 min | Find connection ceiling |
| `sustained` | 100 | 5 min | Steady-state performance |
| `spike` | 100 -> 500 | 3 min | Burst capacity |

## Custom Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `ws_connection_time` | Trend | Time from start to connected (ms) |
| `ws_messages_received` | Counter | Total train update messages received |
| `ws_message_latency` | Trend | Time between connection and message receipt |
| `ws_connection_success` | Rate | Fraction of successful WS connections |

## Thresholds

- P95 connection time < 500ms
- Connection success rate > 99%
- HTTP error rate < 1%

## Infrastructure Constraints

- **EC2 t3.small**: 2 vCPU (burstable), 2GB RAM
- **WS Server**: 512MB Docker memory limit
- **Redis**: 256MB maxmemory
- **Neo4j**: 768MB memory limit

Expected bottleneck: WS server memory at ~300-400 concurrent connections (each Socket.IO connection uses ~1-2KB RAM for buffers + room membership).

## Interpreting Results

The key metric is `ws_connection_success` rate. When it drops below 99%, the server is at capacity. Check:
- `ws_connection_time` p95/p99 for degradation curve
- Docker stats (`docker stats`) for memory pressure
- Server logs for Redis adapter errors (indicates pub/sub bottleneck)
