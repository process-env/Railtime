# k6 Load Tests -- Railtime WebSocket Server

## Prerequisites

1. [k6](https://k6.io/docs/get-started/installation/) **v0.40 or later** (required for `k6/experimental/websockets`)
2. Local stack running:
   ```bash
   docker compose -f docker-compose.v2.yml --env-file .env.v2 up -d
   cd server && npm run dev
   ```

## WebSocket Module

This test uses the `k6/experimental/websockets` module instead of the legacy `k6/ws` module. The experimental module follows the browser WebSocket API and properly buffers messages sent before `onmessage` is assigned. This fixes a race condition in `k6/ws` where the Engine.IO OPEN packet was dropped because the `socket.on('message')` callback had not yet been registered, causing the Socket.IO handshake to stall.

Key differences from the legacy module:
- `new WebSocket(url)` instead of `ws.connect(url, {}, callback)`
- Event handlers via `.onopen`, `.onmessage`, `.onclose`, `.onerror` properties
- Message data accessed via `e.data` (event object) rather than a direct string argument
- VU iteration stays alive as long as the socket is open (no `sleep()` loop needed)
- Timers from `k6/experimental/timers` (`setTimeout`, `setInterval`) for duration control

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
| `ws_connection_time` | Trend | Time from WS open to /trains namespace subscribed (ms) |
| `ws_messages_received` | Counter | Total train update messages received |
| `ws_message_latency` | Trend | Time between first message and subsequent messages |
| `ws_connection_success` | Rate | Fraction of successful Socket.IO handshakes |

## Thresholds

| Metric | Threshold | Notes |
|--------|-----------|-------|
| `ws_connection_time` | P95 < 5s | Relaxed for production EC2 latency |
| `ws_connection_success` | rate > 95% | Allows some failures during spike scenario |
| `ws_messages_received` | count > 0 | Sanity check that data is flowing |

## Protocol Flow

Each VU performs the full Engine.IO 4 + Socket.IO handshake over a direct WebSocket connection (no HTTP long-polling upgrade):

```
Client                                    Server
  |                                         |
  |  --- WS connect /?EIO=4&transport=ws -> |
  |  <-- 0{"sid":"...","pingInterval":...}  |  Engine.IO OPEN
  |  <-- 40                                 |  Socket.IO CONNECT (default ns)
  |  --- 40/trains, --->                    |  Join /trains namespace
  |  <-- 40/trains,{"sid":"..."}            |  Namespace ack
  |  --- 42/trains,["subscribe:all"] --->   |  Subscribe to updates
  |  <-- 42/trains,["trains:update",{...}]  |  Train data (every ~15s)
  |  <-- 2                                  |  Engine.IO PING
  |  --- 3 --->                             |  Engine.IO PONG
  |  ...                                    |
  |  --- close (after 45s) --->             |
```

## Infrastructure Constraints

- **EC2 t3.small**: 2 vCPU (burstable), 2GB RAM
- **WS Server**: 512MB Docker memory limit
- **Redis**: 256MB maxmemory
- **Neo4j**: 768MB memory limit

Expected bottleneck: WS server memory at ~300-400 concurrent connections (each Socket.IO connection uses ~1-2KB RAM for buffers + room membership).

## Interpreting Results

The key metric is `ws_connection_success` rate. When it drops below 95%, the server is at capacity. Check:
- `ws_connection_time` p95/p99 for degradation curve
- Docker stats (`docker stats`) for memory pressure
- Server logs for Redis adapter errors (indicates pub/sub bottleneck)

## Troubleshooting

**0 messages received**: Verify the server is running and broadcasting. Check that the WS_URL points to the correct host and port. Run a quick smoke test with `--vus 1 --duration 10s` and look for the "First message type:" log line.

**k6 version error on import**: The `k6/experimental/websockets` module requires k6 v0.40+. Check your version with `k6 version`.

**Connection timeouts**: The test allows up to 5s (P95) for the full handshake. If running against a remote server, ensure firewalls allow WebSocket upgrades on the target port.
