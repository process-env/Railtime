import { describe, it, expectTypeOf } from 'vitest';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  TrainsServerToClientEvents,
  TrainsClientToServerEvents,
  AlertsServerToClientEvents,
  AlertsClientToServerEvents,
  ArrivalsServerToClientEvents,
  ArrivalsClientToServerEvents,
} from '../ws-events';
import type { TrainPosition, ServiceAlert, ArrivalItem } from '../mta';

// ---------------------------------------------------------------------------
// Server-to-Client Events
// ---------------------------------------------------------------------------

describe('ServerToClientEvents', () => {
  it('includes trains:update event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('trains:update');
  });

  it('includes trains:remove event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('trains:remove');
  });

  it('includes feed:status event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('feed:status');
  });

  it('includes alerts:update event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('alerts:update');
  });

  it('includes alerts:new event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('alerts:new');
  });

  it('includes alerts:cleared event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('alerts:cleared');
  });

  it('includes arrivals:update event', () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty('arrivals:update');
  });
});

// ---------------------------------------------------------------------------
// Client-to-Server Events
// ---------------------------------------------------------------------------

describe('ClientToServerEvents', () => {
  it('includes subscribe:all event', () => {
    expectTypeOf<ClientToServerEvents>().toHaveProperty('subscribe:all');
  });

  it('includes subscribe:route event', () => {
    expectTypeOf<ClientToServerEvents>().toHaveProperty('subscribe:route');
  });

  it('includes unsubscribe:route event', () => {
    expectTypeOf<ClientToServerEvents>().toHaveProperty('unsubscribe:route');
  });

  it('includes subscribe:station event', () => {
    expectTypeOf<ClientToServerEvents>().toHaveProperty('subscribe:station');
  });

  it('includes unsubscribe:station event', () => {
    expectTypeOf<ClientToServerEvents>().toHaveProperty('unsubscribe:station');
  });
});

// ---------------------------------------------------------------------------
// Trains namespace payload types
// ---------------------------------------------------------------------------

describe('TrainsServerToClientEvents payloads', () => {
  it('trains:update payload includes a TrainPosition array', () => {
    type TrainsUpdatePayload = Parameters<TrainsServerToClientEvents['trains:update']>[0];
    expectTypeOf<TrainsUpdatePayload['trains']>().toEqualTypeOf<TrainPosition[]>();
  });

  it('trains:update payload includes feedGroupId string', () => {
    type TrainsUpdatePayload = Parameters<TrainsServerToClientEvents['trains:update']>[0];
    expectTypeOf<TrainsUpdatePayload['feedGroupId']>().toBeString();
  });

  it('trains:update payload includes updatedAt string', () => {
    type TrainsUpdatePayload = Parameters<TrainsServerToClientEvents['trains:update']>[0];
    expectTypeOf<TrainsUpdatePayload['updatedAt']>().toBeString();
  });

  it('trains:update payload includes stale boolean', () => {
    type TrainsUpdatePayload = Parameters<TrainsServerToClientEvents['trains:update']>[0];
    expectTypeOf<TrainsUpdatePayload['stale']>().toBeBoolean();
  });

  it('trains:remove payload includes tripIds string array', () => {
    type TrainsRemovePayload = Parameters<TrainsServerToClientEvents['trains:remove']>[0];
    expectTypeOf<TrainsRemovePayload['tripIds']>().toEqualTypeOf<string[]>();
  });

  it('feed:status payload includes status union type', () => {
    type FeedStatusPayload = Parameters<TrainsServerToClientEvents['feed:status']>[0];
    expectTypeOf<FeedStatusPayload['status']>().toEqualTypeOf<'success' | 'error' | 'timeout'>();
  });

  it('feed:status payload includes tripCount number', () => {
    type FeedStatusPayload = Parameters<TrainsServerToClientEvents['feed:status']>[0];
    expectTypeOf<FeedStatusPayload['tripCount']>().toBeNumber();
  });

  it('feed:status payload includes latencyMs number', () => {
    type FeedStatusPayload = Parameters<TrainsServerToClientEvents['feed:status']>[0];
    expectTypeOf<FeedStatusPayload['latencyMs']>().toBeNumber();
  });
});

// ---------------------------------------------------------------------------
// Trains client-to-server events
// ---------------------------------------------------------------------------

describe('TrainsClientToServerEvents', () => {
  it('subscribe:all takes no arguments', () => {
    type SubscribeAllFn = TrainsClientToServerEvents['subscribe:all'];
    expectTypeOf<Parameters<SubscribeAllFn>>().toEqualTypeOf<[]>();
  });

  it('subscribe:route accepts a string', () => {
    type SubscribeRouteFn = TrainsClientToServerEvents['subscribe:route'];
    expectTypeOf<Parameters<SubscribeRouteFn>[0]>().toBeString();
  });

  it('unsubscribe:route accepts a string', () => {
    type UnsubscribeRouteFn = TrainsClientToServerEvents['unsubscribe:route'];
    expectTypeOf<Parameters<UnsubscribeRouteFn>[0]>().toBeString();
  });
});

// ---------------------------------------------------------------------------
// Alerts namespace payload types
// ---------------------------------------------------------------------------

describe('AlertsServerToClientEvents payloads', () => {
  it('alerts:update payload includes ServiceAlert array', () => {
    type AlertsUpdatePayload = Parameters<AlertsServerToClientEvents['alerts:update']>[0];
    expectTypeOf<AlertsUpdatePayload['alerts']>().toEqualTypeOf<ServiceAlert[]>();
  });

  it('alerts:update payload includes updatedAt string', () => {
    type AlertsUpdatePayload = Parameters<AlertsServerToClientEvents['alerts:update']>[0];
    expectTypeOf<AlertsUpdatePayload['updatedAt']>().toBeString();
  });

  it('alerts:new payload includes a single ServiceAlert', () => {
    type AlertsNewPayload = Parameters<AlertsServerToClientEvents['alerts:new']>[0];
    expectTypeOf<AlertsNewPayload['alert']>().toEqualTypeOf<ServiceAlert>();
  });

  it('alerts:cleared payload includes alertId string', () => {
    type AlertsClearedPayload = Parameters<AlertsServerToClientEvents['alerts:cleared']>[0];
    expectTypeOf<AlertsClearedPayload['alertId']>().toBeString();
  });
});

// ---------------------------------------------------------------------------
// Arrivals namespace payload types
// ---------------------------------------------------------------------------

describe('ArrivalsServerToClientEvents payloads', () => {
  it('arrivals:update payload includes ArrivalItem array', () => {
    type ArrivalsUpdatePayload = Parameters<ArrivalsServerToClientEvents['arrivals:update']>[0];
    expectTypeOf<ArrivalsUpdatePayload['arrivals']>().toEqualTypeOf<ArrivalItem[]>();
  });

  it('arrivals:update payload includes stationId string', () => {
    type ArrivalsUpdatePayload = Parameters<ArrivalsServerToClientEvents['arrivals:update']>[0];
    expectTypeOf<ArrivalsUpdatePayload['stationId']>().toBeString();
  });

  it('arrivals:update payload includes updatedAt string', () => {
    type ArrivalsUpdatePayload = Parameters<ArrivalsServerToClientEvents['arrivals:update']>[0];
    expectTypeOf<ArrivalsUpdatePayload['updatedAt']>().toBeString();
  });
});

describe('ArrivalsClientToServerEvents', () => {
  it('subscribe:station accepts a string', () => {
    type SubscribeStationFn = ArrivalsClientToServerEvents['subscribe:station'];
    expectTypeOf<Parameters<SubscribeStationFn>[0]>().toBeString();
  });

  it('unsubscribe:station accepts a string', () => {
    type UnsubscribeStationFn = ArrivalsClientToServerEvents['unsubscribe:station'];
    expectTypeOf<Parameters<UnsubscribeStationFn>[0]>().toBeString();
  });
});

// ---------------------------------------------------------------------------
// Combined interface extends all namespaces
// ---------------------------------------------------------------------------

describe('Combined interfaces extend all namespaces', () => {
  it('ServerToClientEvents extends TrainsServerToClientEvents', () => {
    expectTypeOf<ServerToClientEvents>().toMatchTypeOf<TrainsServerToClientEvents>();
  });

  it('ServerToClientEvents extends AlertsServerToClientEvents', () => {
    expectTypeOf<ServerToClientEvents>().toMatchTypeOf<AlertsServerToClientEvents>();
  });

  it('ServerToClientEvents extends ArrivalsServerToClientEvents', () => {
    expectTypeOf<ServerToClientEvents>().toMatchTypeOf<ArrivalsServerToClientEvents>();
  });

  it('ClientToServerEvents extends TrainsClientToServerEvents', () => {
    expectTypeOf<ClientToServerEvents>().toMatchTypeOf<TrainsClientToServerEvents>();
  });

  it('ClientToServerEvents extends AlertsClientToServerEvents', () => {
    expectTypeOf<ClientToServerEvents>().toMatchTypeOf<AlertsClientToServerEvents>();
  });

  it('ClientToServerEvents extends ArrivalsClientToServerEvents', () => {
    expectTypeOf<ClientToServerEvents>().toMatchTypeOf<ArrivalsClientToServerEvents>();
  });
});
