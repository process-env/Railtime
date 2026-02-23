import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const wsConnectionTime = new Trend('ws_connection_time', true);
const wsMessagesReceived = new Counter('ws_messages_received');
const wsMessageLatency = new Trend('ws_message_latency', true);
const wsConnectionSuccess = new Rate('ws_connection_success');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.WS_URL || 'http://localhost:3001';
const WS_URL = BASE_URL.replace('http', 'ws');

export const options = {
  scenarios: {
    // Scenario 1: Ramp up connections gradually
    connection_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },  // ramp to 200
        { duration: '3m', target: 200 },  // hold at 200
        { duration: '1m', target: 0 },    // ramp down
      ],
      gracefulRampDown: '30s',
      exec: 'socketIOTest',
    },
    // Scenario 2: Sustained load
    sustained: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      startTime: '7m',  // starts after connection_ramp finishes
      exec: 'socketIOTest',
    },
    // Scenario 3: Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '30s', target: 500 },  // spike to 500
        { duration: '2m', target: 500 },   // hold at 500
        { duration: '30s', target: 100 },  // back to 100
      ],
      startTime: '13m',  // starts after sustained finishes
      gracefulRampDown: '30s',
      exec: 'socketIOTest',
    },
  },
  thresholds: {
    'ws_connection_time': ['p(95)<500'],      // 95th percentile < 500ms
    'ws_connection_success': ['rate>0.99'],    // >99% connections succeed
    'ws_messages_received': ['count>0'],       // at least some messages received
    'http_req_failed': ['rate<0.01'],          // <1% HTTP errors (polling handshake)
  },
};

// ---------------------------------------------------------------------------
// Engine.IO/Socket.IO handshake helpers
// ---------------------------------------------------------------------------

/**
 * Socket.IO 4 uses Engine.IO which requires:
 * 1. HTTP polling request to get session ID (sid)
 * 2. WebSocket upgrade with that sid
 * 3. Send "40/trains," to connect to the /trains namespace
 * 4. Send subscription event
 */
function getSessionId(namespace) {
  const path = namespace ? '/socket.io/?EIO=4&transport=polling&nsp=' + namespace : '/socket.io/?EIO=4&transport=polling';
  var res = http.get(BASE_URL + path);

  if (res.status !== 200) {
    return null;
  }

  // Engine.IO polling response format: <length>:<packet>
  // The "0" packet type is OPEN, containing JSON with sid
  var body = res.body;
  try {
    // Find the JSON payload (after the length prefix)
    var jsonStart = body.indexOf('{');
    if (jsonStart === -1) return null;
    var jsonEnd = body.lastIndexOf('}');
    var json = JSON.parse(body.substring(jsonStart, jsonEnd + 1));
    return json.sid || null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main test function
// ---------------------------------------------------------------------------

export function socketIOTest() {
  var connectStart = Date.now();

  // Step 1: Get session ID via polling handshake
  var sid = getSessionId();
  if (!sid) {
    wsConnectionSuccess.add(0);
    console.warn('Failed to get session ID');
    sleep(1);
    return;
  }

  // Step 2: Open WebSocket with Engine.IO upgrade
  var url = WS_URL + '/socket.io/?EIO=4&transport=websocket&sid=' + sid;

  var res = ws.connect(url, {}, function (socket) {
    var connectDuration = Date.now() - connectStart;
    wsConnectionTime.add(connectDuration);
    wsConnectionSuccess.add(1);

    var connected = false;

    socket.on('open', function () {
      // Engine.IO upgrade probe
      socket.send('2probe');
    });

    socket.on('message', function (data) {
      // Engine.IO protocol:
      // "3probe" = pong to our probe
      // "5" = upgrade acknowledgment
      // "40" = Socket.IO CONNECT to default namespace
      // "40/trains," = Socket.IO CONNECT to /trains namespace
      // "42/trains,..." = Socket.IO EVENT on /trains namespace

      if (data === '3probe') {
        // Probe response -- send upgrade
        socket.send('5');
        return;
      }

      if (data === '40') {
        // Connected to default namespace -- now connect to /trains
        socket.send('40/trains,');
        return;
      }

      if (data.startsWith('40/trains')) {
        // Connected to /trains namespace -- subscribe to all trains
        connected = true;
        // Socket.IO event format: 42/namespace,["eventName", ...args]
        // subscribe:all takes no arguments
        socket.send('42/trains,["subscribe:all"]');
        return;
      }

      if (data.startsWith('42/trains')) {
        // Received a trains event (trains:update, trains:remove, feed:status)
        wsMessagesReceived.add(1);
        wsMessageLatency.add(Date.now() - connectStart);
        return;
      }

      // Engine.IO ping/pong keepalive
      if (data === '2') {
        socket.send('3');
        return;
      }
    });

    socket.on('error', function (e) {
      console.error('WebSocket error:', e.error());
    });

    // Keep connection open for the VU's iteration duration
    // Sleep in small increments to allow message processing
    var testDuration = 15; // seconds per iteration
    for (var i = 0; i < testDuration; i++) {
      sleep(1);
    }

    // Graceful disconnect
    socket.close();
  });

  check(res, {
    'ws connection status is 101': function (r) { return r && r.status === 101; },
  });
}

// ---------------------------------------------------------------------------
// Default function (required by k6)
// ---------------------------------------------------------------------------

export default function () {
  socketIOTest();
}
