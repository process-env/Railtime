import type {
  TrainPosition,
  ArrivalItem,
  ArrivalBoard,
  ServiceAlert,
  AlertSeverity,
  FeedEntity,
  StopUpdate,
  Stop,
  Route,
} from '@/types/mta';

let idCounter = 0;

function generateId(prefix = 'mock'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Create a mock TrainPosition
 */
export function createMockTrainPosition(
  overrides: Partial<TrainPosition> = {}
): TrainPosition {
  return {
    tripId: generateId('trip'),
    routeId: '1',
    lat: 40.7484,
    lon: -73.9857,
    heading: 180,
    nextStopId: '101N',
    nextStopName: 'Test Station',
    eta: new Date(Date.now() + 5 * 60000).toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple mock TrainPositions
 */
export function createMockTrainPositions(
  count: number,
  overrides: Partial<TrainPosition> = {}
): TrainPosition[] {
  return Array.from({ length: count }, () => createMockTrainPosition(overrides));
}

/**
 * Create a mock ArrivalItem
 */
export function createMockArrival(overrides: Partial<ArrivalItem> = {}): ArrivalItem {
  const whenISO = new Date(Date.now() + 5 * 60000).toISOString();
  return {
    stopId: '101N',
    stopName: 'Test Station',
    whenISO,
    whenLocal: '12:05 PM',
    in: '5 min',
    routeId: '1',
    tripId: generateId('trip'),
    scheduleRelationship: 'SCHEDULED',
    meta: {
      arrivalDelay: null,
      departureDelay: null,
    },
    ...overrides,
  };
}

/**
 * Create multiple mock ArrivalItems
 */
export function createMockArrivals(
  count: number,
  overrides: Partial<ArrivalItem> = {}
): ArrivalItem[] {
  return Array.from({ length: count }, (_, i) =>
    createMockArrival({
      ...overrides,
      whenISO: new Date(Date.now() + (i + 1) * 60000).toISOString(),
      in: `${i + 1} min`,
    })
  );
}

/**
 * Create a mock ArrivalBoard
 */
export function createMockArrivalBoard(
  overrides: Partial<ArrivalBoard> = {}
): ArrivalBoard {
  return {
    stopId: '101',
    stopName: 'Test Station',
    updatedAt: new Date().toISOString(),
    now: new Date().toISOString(),
    arrivals: createMockArrivals(3),
    ...overrides,
  };
}

/**
 * Create a mock ServiceAlert
 */
export function createMockServiceAlert(
  overrides: Partial<ServiceAlert> = {}
): ServiceAlert {
  return {
    id: generateId('alert'),
    alertType: 'Delays',
    severity: 'warning' as AlertSeverity,
    headerText: 'Test Alert',
    descriptionHtml: '<p>Test alert description</p>',
    affectedRoutes: ['1', '2', '3'],
    affectedStops: ['101', '102'],
    affectedStopNames: ['Test Station 1', 'Test Station 2'],
    activePeriods: [
      {
        start: new Date(Date.now() - 3600000).toISOString(),
        end: new Date(Date.now() + 3600000).toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple mock ServiceAlerts
 */
export function createMockAlerts(
  count: number,
  overrides: Partial<ServiceAlert> = {}
): ServiceAlert[] {
  return Array.from({ length: count }, () => createMockServiceAlert(overrides));
}

/**
 * Create a mock StopUpdate
 */
export function createMockStopUpdate(
  overrides: Partial<StopUpdate> = {}
): StopUpdate {
  return {
    stopId: '101N',
    stopName: 'Test Station',
    arrival: {
      time: new Date(Date.now() + 5 * 60000).toISOString(),
      delay: null,
    },
    departure: {
      time: new Date(Date.now() + 5.5 * 60000).toISOString(),
      delay: null,
    },
    scheduleRelationship: null,
    ...overrides,
  };
}

/**
 * Create a mock FeedEntity
 */
export function createMockFeedEntity(
  overrides: Partial<FeedEntity> = {}
): FeedEntity {
  return {
    id: generateId('entity'),
    routeId: '1',
    tripId: generateId('trip'),
    startDate: '20240115',
    vehicleId: generateId('vehicle'),
    stopUpdates: [
      createMockStopUpdate({ stopId: '101N' }),
      createMockStopUpdate({ stopId: '102N' }),
      createMockStopUpdate({ stopId: '103N' }),
    ],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple mock FeedEntities
 */
export function createMockFeedEntities(
  count: number,
  overrides: Partial<FeedEntity> = {}
): FeedEntity[] {
  return Array.from({ length: count }, () => createMockFeedEntity(overrides));
}

/**
 * Create a mock Stop
 */
export function createMockStop(overrides: Partial<Stop> = {}): Stop {
  const id = overrides.id || generateId('stop');
  return {
    id,
    name: 'Test Station',
    lat: 40.7484,
    lon: -73.9857,
    routes: '1,2,3',
    parent: null,
    ...overrides,
  };
}

/**
 * Create multiple mock Stops
 */
export function createMockStops(
  count: number,
  overrides: Partial<Stop> = {}
): Stop[] {
  return Array.from({ length: count }, () => createMockStop(overrides));
}

/**
 * Create a mock Route
 */
export function createMockRoute(overrides: Partial<Route> = {}): Route {
  return {
    route_id: '1',
    short_name: '1',
    long_name: 'Broadway - 7 Avenue Local',
    desc: null,
    type: '1',
    color: 'EE352E',
    text_color: 'FFFFFF',
    ...overrides,
  };
}

/**
 * Create all subway routes
 */
export function createAllSubwayRoutes(): Route[] {
  const routes = [
    { id: '1', color: 'EE352E' },
    { id: '2', color: 'EE352E' },
    { id: '3', color: 'EE352E' },
    { id: '4', color: '00933C' },
    { id: '5', color: '00933C' },
    { id: '6', color: '00933C' },
    { id: '7', color: 'B933AD' },
    { id: 'A', color: '0039A6' },
    { id: 'C', color: '0039A6' },
    { id: 'E', color: '0039A6' },
    { id: 'B', color: 'FF6319' },
    { id: 'D', color: 'FF6319' },
    { id: 'F', color: 'FF6319' },
    { id: 'M', color: 'FF6319' },
    { id: 'G', color: '6CBE45' },
    { id: 'J', color: '996633' },
    { id: 'Z', color: '996633' },
    { id: 'L', color: 'A7A9AC' },
    { id: 'N', color: 'FCCC0A' },
    { id: 'Q', color: 'FCCC0A' },
    { id: 'R', color: 'FCCC0A' },
    { id: 'W', color: 'FCCC0A' },
    { id: 'S', color: '808183' },
  ];

  return routes.map(({ id, color }) =>
    createMockRoute({
      route_id: id,
      short_name: id,
      long_name: `${id} Train`,
      color,
    })
  );
}

/**
 * Reset the ID counter (useful between tests)
 */
export function resetFactoryCounter(): void {
  idCounter = 0;
}
