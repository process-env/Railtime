# Plan: TomTom Geofence Alert System

**Last Updated: 2025-12-07**

## Executive Summary

Implement a real-time train arrival alert system using TomTom's Geofencing API. Users can subscribe to stations and receive push notifications when their train approaches (enters geofence) or arrives (at station).

## Current State Analysis

### What We Have
- Real-time train positions from MTA GTFS-RT feeds (updated every 15s)
- ~470 subway stations with lat/lon coordinates
- Station detail pages with arrival boards
- TomTom API key already configured (`TOMTOM_ADMIN_KEY`)
- No user authentication system currently

### Gaps
- No push notification infrastructure
- No user subscription system
- No geofence management
- No webhook endpoint for TomTom callbacks

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│  1. User visits station page                                    │
│  2. Clicks "Alert me when [A] train approaches"                 │
│  3. Grants push notification permission                         │
│  4. Subscription saved to database                              │
│  5. When train enters geofence → webhook → push notification    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     SYSTEM ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │  Client  │───▶│ Next.js  │───▶│ Postgres │                  │
│  │  (PWA)   │    │   API    │    │   DB     │                  │
│  └──────────┘    └──────────┘    └──────────┘                  │
│       ▲               │               │                         │
│       │               │               │                         │
│  Push │               ▼               │                         │
│  Notif│         ┌──────────┐          │                         │
│       │         │  TomTom  │          │                         │
│       │         │Geofencing│          │                         │
│       │         │   API    │          │                         │
│       │         └──────────┘          │                         │
│       │               │               │                         │
│       │          Webhook              │                         │
│       │               ▼               │                         │
│       │         ┌──────────┐          │                         │
│       └─────────│ Webhook  │◀─────────┘                         │
│                 │ Handler  │                                    │
│                 └──────────┘                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
Set up database schema, TomTom geofencing project, and basic subscription API.

### Phase 2: Geofence Management (Week 2)
Create geofences for all stations, build train position reporting system.

### Phase 3: Push Notifications (Week 3)
Implement Web Push API, service worker, and notification UI.

### Phase 4: Webhook Handler (Week 4)
Build webhook endpoint, event processing, and notification dispatch.

### Phase 5: User Experience (Week 5)
Station page integration, subscription management UI, alert history.

---

## Phase 1: Foundation

### 1.1 Database Schema
**Effort: M** | **Priority: P0**

Create Prisma schema for subscriptions and geofences.

```prisma
model GeofenceAlert {
  id            String   @id @default(cuid())

  // Subscription target
  stationId     String   // e.g., "A32N" (125th St northbound)
  routeId       String?  // Optional: specific route (e.g., "A")

  // User identification (anonymous for now)
  pushEndpoint  String   // Web Push subscription endpoint
  pushP256dh    String   // Web Push key
  pushAuth      String   // Web Push auth

  // TomTom geofence reference
  tomtomFenceId String?  // Created after setup

  // Settings
  alertOnApproach Boolean @default(true)  // 2 stops away
  alertOnArrival  Boolean @default(true)  // Entering station

  // Metadata
  createdAt     DateTime @default(now())
  lastTriggered DateTime?
  isActive      Boolean  @default(true)

  @@index([stationId])
  @@index([pushEndpoint])
}

model TomTomGeofence {
  id            String   @id @default(cuid())
  stationId     String   @unique
  tomtomFenceId String   @unique
  radiusMeters  Int      @default(150)
  createdAt     DateTime @default(now())

  @@index([tomtomFenceId])
}
```

**Acceptance Criteria:**
- [ ] Schema added to `prisma/schema.prisma`
- [ ] Migration runs successfully
- [ ] Can create/query subscriptions

### 1.2 TomTom Geofencing Project Setup
**Effort: S** | **Priority: P0**

Create a TomTom Geofencing project via API.

```typescript
// POST https://api.tomtom.com/geofencing/1/projects
// Response: { id: "project-uuid", name: "nyc-subway-alerts" }
```

**Acceptance Criteria:**
- [ ] Project created in TomTom dashboard
- [ ] Project ID stored in environment variables
- [ ] Webhook URL configured in TomTom Notifications API

### 1.3 Environment Configuration
**Effort: S** | **Priority: P0**

Add required environment variables.

```env
# TomTom Geofencing
TOMTOM_GEOFENCING_PROJECT_ID=<project-id>
TOMTOM_WEBHOOK_SECRET=<random-secret>

# Web Push (generate with web-push library)
VAPID_PUBLIC_KEY=<public-key>
VAPID_PRIVATE_KEY=<private-key>
VAPID_SUBJECT=mailto:alerts@yourapp.com
```

**Acceptance Criteria:**
- [ ] All env vars documented in `.env.example`
- [ ] VAPID keys generated
- [ ] Secrets added to Vercel

---

## Phase 2: Geofence Management

### 2.1 Station Geofence Creation Script
**Effort: L** | **Priority: P0**

Build script to create geofences for all 470 stations.

```typescript
// scripts/create-station-geofences.ts
async function createStationGeofences() {
  const stations = await loadStations();

  for (const station of stations) {
    await tomtom.createFence({
      projectId: TOMTOM_PROJECT_ID,
      name: `station-${station.id}`,
      geometry: {
        type: 'Point',
        shapeType: 'Circle',
        radius: 150, // meters
        coordinates: [station.lon, station.lat]
      }
    });

    // Save to database
    await prisma.tomTomGeofence.create({
      data: {
        stationId: station.id,
        tomtomFenceId: response.id,
        radiusMeters: 150
      }
    });
  }
}
```

**Acceptance Criteria:**
- [ ] Script creates geofences for all stations
- [ ] Geofence IDs stored in database
- [ ] Can query geofence by station ID
- [ ] Handles rate limiting (TomTom allows ~10 req/sec)

### 2.2 Train Position Reporter
**Effort: L** | **Priority: P0**

Report train positions to TomTom Geofencing API.

```typescript
// src/lib/geofencing/train-reporter.ts
async function reportTrainPositions(trains: TrainPosition[]) {
  for (const train of trains) {
    await tomtom.updateObjectPosition({
      objectId: train.tripId,
      position: {
        latitude: train.lat,
        longitude: train.lon
      }
    });
  }
}
```

**Integration Point:** Hook into existing train polling (every 15s).

**Acceptance Criteria:**
- [ ] Train positions sent to TomTom every 15s
- [ ] Only report trains that have moved
- [ ] Handle API errors gracefully
- [ ] Metrics: track API latency and errors

### 2.3 TomTom API Client
**Effort: M** | **Priority: P0**

Create typed client for TomTom Geofencing API.

```typescript
// src/lib/tomtom/geofencing-client.ts
export class TomTomGeofencingClient {
  async createProject(name: string): Promise<Project>
  async createFence(projectId: string, fence: FenceInput): Promise<Fence>
  async updateObjectPosition(objectId: string, position: Position): Promise<void>
  async getTransitions(objectId: string, options?: TransitionQuery): Promise<Transition[]>
}
```

**Acceptance Criteria:**
- [ ] All required endpoints implemented
- [ ] Proper error handling and retries
- [ ] TypeScript types for all responses
- [ ] Rate limiting handling

---

## Phase 3: Push Notifications

### 3.1 Service Worker Setup
**Effort: M** | **Priority: P1**

Create service worker for push notifications.

```typescript
// public/sw.js
self.addEventListener('push', (event) => {
  const data = event.data.json();

  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/train-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag, // Prevents duplicate notifications
    data: { url: data.url }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  clients.openWindow(event.notification.data.url);
});
```

**Acceptance Criteria:**
- [ ] Service worker registered on app load
- [ ] Push events handled correctly
- [ ] Notification click opens correct page
- [ ] Works offline

### 3.2 Push Subscription API
**Effort: M** | **Priority: P1**

API endpoints for managing push subscriptions.

```typescript
// POST /api/v1/alerts/subscribe
// Body: { stationId, routeId?, pushSubscription }
// Returns: { subscriptionId }

// DELETE /api/v1/alerts/subscribe/:id
// Unsubscribe from alerts

// GET /api/v1/alerts/subscriptions
// Returns user's active subscriptions
```

**Acceptance Criteria:**
- [ ] Can create subscription with push endpoint
- [ ] Can delete subscription
- [ ] Can list active subscriptions
- [ ] Validates push subscription format

### 3.3 Push Notification Sender
**Effort: S** | **Priority: P1**

Utility to send Web Push notifications.

```typescript
// src/lib/push/send-notification.ts
import webpush from 'web-push';

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: NotificationPayload
): Promise<void> {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}
```

**Acceptance Criteria:**
- [ ] Uses VAPID for authentication
- [ ] Handles expired subscriptions (410 response)
- [ ] Retries on temporary failures

---

## Phase 4: Webhook Handler

### 4.1 Webhook Endpoint
**Effort: M** | **Priority: P0**

Receive and process TomTom geofence events.

```typescript
// src/app/api/v1/webhooks/tomtom/route.ts
export async function POST(request: Request) {
  // Verify webhook signature
  const signature = request.headers.get('x-tomtom-signature');
  if (!verifySignature(signature, body)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = await request.json();

  // Event: { objectId, fenceId, transitionType: 'enter' | 'exit', timestamp }

  if (event.transitionType === 'enter') {
    await handleTrainApproaching(event);
  }

  return Response.json({ received: true });
}
```

**Acceptance Criteria:**
- [ ] Endpoint receives TomTom webhooks
- [ ] Signature verification working
- [ ] Events processed asynchronously
- [ ] Errors logged to Sentry

### 4.2 Alert Dispatch Logic
**Effort: M** | **Priority: P0**

Match geofence events to subscriptions and send notifications.

```typescript
async function handleTrainApproaching(event: GeofenceEvent) {
  // Get station from fence ID
  const geofence = await prisma.tomTomGeofence.findUnique({
    where: { tomtomFenceId: event.fenceId }
  });

  // Get train details
  const train = await getTrainDetails(event.objectId);

  // Find matching subscriptions
  const subscriptions = await prisma.geofenceAlert.findMany({
    where: {
      stationId: geofence.stationId,
      routeId: train.routeId, // or null for all routes
      isActive: true,
      alertOnApproach: true
    }
  });

  // Send notifications
  for (const sub of subscriptions) {
    await sendPushNotification(sub, {
      title: `${train.routeId} Train Approaching`,
      body: `Arriving at ${geofence.stationName} in ~2 minutes`,
      url: `/stations/${geofence.stationId}`
    });

    // Update last triggered
    await prisma.geofenceAlert.update({
      where: { id: sub.id },
      data: { lastTriggered: new Date() }
    });
  }
}
```

**Acceptance Criteria:**
- [ ] Correct subscriptions matched
- [ ] Notifications sent within 5 seconds
- [ ] Duplicate notifications prevented (rate limit)
- [ ] Failed sends logged and retried

---

## Phase 5: User Experience

### 5.1 Subscribe Button Component
**Effort: M** | **Priority: P1**

Add alert subscription UI to station pages.

```tsx
// src/components/alerts/AlertSubscribeButton.tsx
export function AlertSubscribeButton({ stationId, routeId }: Props) {
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = async () => {
    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Get push subscription
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY
    });

    // Send to API
    await fetch('/api/v1/alerts/subscribe', {
      method: 'POST',
      body: JSON.stringify({ stationId, routeId, pushSubscription: subscription })
    });

    setIsSubscribed(true);
  };

  return (
    <Button onClick={handleSubscribe}>
      <Bell className="h-4 w-4 mr-2" />
      {isSubscribed ? 'Subscribed' : 'Alert Me'}
    </Button>
  );
}
```

**Acceptance Criteria:**
- [ ] Button appears on station detail page
- [ ] Requests notification permission
- [ ] Shows subscribed state
- [ ] Can unsubscribe

### 5.2 Subscription Management Page
**Effort: M** | **Priority: P2**

Page to view and manage all subscriptions.

```
/alerts
├── List of active subscriptions
├── Toggle enable/disable
├── Delete subscription
└── Link to each station
```

**Acceptance Criteria:**
- [ ] Shows all active subscriptions
- [ ] Can toggle alerts on/off
- [ ] Can delete subscriptions
- [ ] Persists across sessions (localStorage + push endpoint)

### 5.3 Alert History
**Effort: S** | **Priority: P3**

Show recent alerts received.

**Acceptance Criteria:**
- [ ] Last 10 alerts shown
- [ ] Stored in localStorage
- [ ] Clears after 24 hours

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TomTom API in Preview (breaking changes) | Medium | High | Abstraction layer, monitor release notes |
| Rate limiting (470 stations × 400 trains) | Medium | High | Batch updates, only report moving trains |
| Push notification permission denied | High | Medium | Clear value proposition, fallback to email |
| Webhook latency | Low | Medium | Async processing, queue system |
| Cost overruns | Medium | Medium | Monitor usage, optimize update frequency |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Notification latency | < 10 seconds from train entering geofence |
| Push delivery rate | > 95% |
| Subscription conversion | > 20% of station page visitors |
| User retention | > 50% still subscribed after 7 days |

---

## Dependencies

- **TomTom Geofencing API** - Public Preview, may have breaking changes
- **Web Push** - Requires HTTPS and service worker
- **Prisma** - Already in use
- **Vercel** - For webhook endpoint (needs public URL)

---

## Cost Estimate

| Component | Monthly Cost |
|-----------|-------------|
| TomTom Geofencing API | $500-1,500 (depending on train count) |
| Vercel (webhook processing) | Included in current plan |
| Database (subscriptions) | Included in current plan |
| **Total** | **$500-1,500/month** |

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Foundation | 1 week | None |
| Phase 2: Geofence Management | 1 week | Phase 1 |
| Phase 3: Push Notifications | 1 week | Phase 1 |
| Phase 4: Webhook Handler | 1 week | Phase 2, 3 |
| Phase 5: User Experience | 1 week | Phase 4 |
| **Total** | **5 weeks** | |
