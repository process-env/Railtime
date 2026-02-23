import { WebSocket } from 'k6/websockets';
import { Counter, Trend, Rate } from 'k6/metrics';


// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

var wsConnectionTime = new Trend('ws_connection_time', true);
var wsMessagesReceived = new Counter('ws_messages_received');
var wsMessageLatency = new Trend('ws_message_latency', true);
var wsConnectionSuccess = new Rate('ws_connection_success');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

var BASE_URL = __ENV.WS_URL || 'http://localhost:3001';
var WS_URL = BASE_URL.replace('http', 'ws');

// How long each VU keeps its connection open (ms).
// 45s gives 3 feed cycles at the 15s broadcast interval.
var CONNECTION_DURATION_MS = 45000;

export var options = {
  scenarios: {
    // Scenario 1: Ramp up connections gradually
    connection_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '3m', target: 200 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'socketIOTest',
    },
    // Scenario 2: Sustained load
    sustained: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      startTime: '7m',
      exec: 'socketIOTest',
    },
    // Scenario 3: Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '2m', target: 500 },
        { duration: '30s', target: 100 },
      ],
      startTime: '13m',
      gracefulRampDown: '30s',
      exec: 'socketIOTest',
    },
  },
  thresholds: {
    'ws_connection_time': ['p(95)<5000'],
    'ws_connection_success': ['rate>0.95'],
    'ws_messages_received': ['count>0'],
  },
};

// ---------------------------------------------------------------------------
// Main test function -- Direct WebSocket with k6/experimental/websockets
// ---------------------------------------------------------------------------
//
// Engine.IO 4 direct WebSocket protocol:
//   1. WS connect to /socket.io/?EIO=4&transport=websocket
//   2. Server sends OPEN: 0{"sid":"...","pingInterval":25000,...}
//   3. Client sends SIO CONNECT to default namespace: 40
//   4. Server responds with default namespace ack: 40{"sid":"..."}
//   5. Client sends namespace connect: 40/trains,
//   6. Server sends namespace ack: 40/trains,{"sid":"..."}
//   7. Client sends subscribe: 42/trains,["subscribe:all"]
//   8. Server sends events: 42/trains,["trains:update",{...}]
//   9. Server sends periodic pings: 2 -- client responds: 3
//
// The k6/experimental/websockets module follows the browser WebSocket API.
// Messages sent before onmessage is assigned are properly buffered, which
// fixes the race condition in k6/ws where the Engine.IO OPEN packet was
// dropped because socket.on('message') had not yet been registered.
// ---------------------------------------------------------------------------

export function socketIOTest() {
  var url = WS_URL + '/socket.io/?EIO=4&transport=websocket';
  var connectStart = Date.now();
  var connectedDefault = false;
  var subscribed = false;
  var firstMessageTime = 0;
  var loggedFirstMessage = false;
  var closeTimer = null;
  var pingInterval = null;

  var ws = new WebSocket(url);

  ws.onopen = function () {
    // Server initiates the handshake by sending the OPEN packet.
    // Nothing to send here -- just wait for onmessage.

    // Schedule connection close after the desired duration.
    // The k6/experimental/websockets module keeps the VU alive as long as
    // the socket is open, so this timer controls iteration length.
    closeTimer = setTimeout(function () {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      ws.close();
    }, CONNECTION_DURATION_MS);
  };

  ws.onmessage = function (e) {
    var data = e.data;

    // Log the very first message per VU for debugging (once only).
    if (!loggedFirstMessage) {
      loggedFirstMessage = true;
      console.log('First message type: ' + data.substring(0, 20));
    }

    // --- Engine.IO OPEN packet: 0{"sid":"...","upgrades":[],...} ---
    if (data.charAt(0) === '0' && data.charAt(1) === '{') {
      // In Socket.IO v4 the CLIENT must initiate the default namespace
      // connection by sending 40. The server does NOT send 40 first.
      ws.send('40');
      return;
    }

    // --- Socket.IO default namespace CONNECT ack: 40{"sid":"..."} ---
    // Matches 40 or 40{"sid":"..."} but NOT 40/trains,... (namespace packets).
    if (!connectedDefault && data.substring(0, 2) === '40' && data.charAt(2) !== '/') {
      connectedDefault = true;
      ws.send('40/trains,');
      return;
    }

    // --- Socket.IO CONNECT ack for /trains namespace: 40/trains,{...} ---
    if (data.indexOf('40/trains') === 0 && !subscribed) {
      subscribed = true;
      wsConnectionTime.add(Date.now() - connectStart);
      wsConnectionSuccess.add(1);
      ws.send('42/trains,["subscribe:all"]');
      return;
    }

    // --- Socket.IO EVENT on /trains: 42/trains,[...] ---
    if (data.indexOf('42/trains') === 0) {
      wsMessagesReceived.add(1);
      if (firstMessageTime === 0) {
        firstMessageTime = Date.now();
      }
      wsMessageLatency.add(Date.now() - firstMessageTime);
      return;
    }

    // --- Engine.IO PING: 2 -> respond with PONG: 3 ---
    if (data === '2') {
      ws.send('3');
      return;
    }
  };

  ws.onerror = function (e) {
    if (e && e.error && String(e.error).indexOf('close sent') === -1) {
      console.error('WebSocket error:', e.error);
    }
    // If we never completed the handshake, record a connection failure.
    if (!subscribed) {
      wsConnectionSuccess.add(0);
    }
  };

  ws.onclose = function () {
    // Clean up timers if still active (e.g. server-initiated close).
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (pingInterval !== null) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    // If the socket closed before we finished the handshake, record failure.
    if (!subscribed) {
      wsConnectionSuccess.add(0);
    }
  };
}

export default function () {
  socketIOTest();
}
