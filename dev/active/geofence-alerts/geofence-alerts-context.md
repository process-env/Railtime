# Geofence Alerts - Context & Reference

**Last Updated: 2025-12-07**

## Key Files

### Existing Infrastructure

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/hooks/use-train-positions.ts` | Polls train positions every 15s | Integration point for position reporting |
| `src/app/api/v1/trains/route.ts` | Train positions API | Source of train data |
| `src/app/(dashboard)/stations/[stationId]/page.tsx` | Station detail page | UI for subscribe button |
| `prisma/schema.prisma` | Database schema | Add subscription tables |
| `.env` | Environment variables | Add TomTom geofencing config |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/tomtom/geofencing-client.ts` | TomTom Geofencing API client |
| `src/lib/push/send-notification.ts` | Web Push sender utility |
| `src/app/api/v1/webhooks/tomtom/route.ts` | Webhook handler |
| `src/app/api/v1/alerts/subscribe/route.ts` | Subscription API |
| `src/components/alerts/AlertSubscribeButton.tsx` | Subscribe UI |
| `public/sw.js` | Service worker for push |
| `scripts/create-station-geofences.ts` | One-time setup script |

---

## TomTom API Reference

### Base URLs
- Geofencing: `https://api.tomtom.com/geofencing/1`
- Notifications: `https://api.tomtom.com/notifications/1`

### Key Endpoints

```
# Projects
POST   /projects                    Create project
GET    /projects/{id}               Get project
DELETE /projects/{id}               Delete project

# Fences
POST   /projects/{id}/fence         Create fence
GET    /projects/{id}/fence/{fid}   Get fence
DELETE /projects/{id}/fence/{fid}   Delete fence

# Objects (trains)
POST   /objects/{id}/position       Update position
GET    /objects/{id}/position       Get current position

# Transitions
GET    /transitions/objects/{id}    Get object transitions
GET    /transitions/fences/{id}     Get fence transitions

# Notifications
POST   /contact-groups              Create webhook group
POST   /alerts                      Create alert rule
```

### Authentication
All requests require `key` query parameter:
```
?key={TOMTOM_ADMIN_KEY}
```

### Rate Limits
- 10 requests/second (default)
- 2,500 free requests/day
- Contact sales for higher limits

---

## Web Push Reference

### VAPID Key Generation
```bash
npx web-push generate-vapid-keys
```

### Push Subscription Object
```typescript
interface PushSubscription {
  endpoint: string;        // https://fcm.googleapis.com/...
  keys: {
    p256dh: string;        // Base64 public key
    auth: string;          // Base64 auth secret
  };
}
```

### Notification Payload
```typescript
interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;           // 192x192 recommended
  badge?: string;          // 72x72 for Android
  tag?: string;            // Prevents duplicates
  data?: {
    url?: string;          // Open on click
  };
}
```

---

## Database Schema

```prisma
model GeofenceAlert {
  id            String   @id @default(cuid())
  stationId     String
  routeId       String?
  pushEndpoint  String
  pushP256dh    String
  pushAuth      String
  tomtomFenceId String?
  alertOnApproach Boolean @default(true)
  alertOnArrival  Boolean @default(true)
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

---

## Environment Variables

```env
# Existing
TOMTOM_ADMIN_KEY=xxx                    # Already configured

# New - TomTom Geofencing
TOMTOM_GEOFENCING_PROJECT_ID=xxx        # Created via API
TOMTOM_WEBHOOK_SECRET=xxx               # For signature verification

# New - Web Push
VAPID_PUBLIC_KEY=xxx                    # Generated with web-push
VAPID_PRIVATE_KEY=xxx                   # Keep secret!
VAPID_SUBJECT=mailto:alerts@app.com     # Contact email
```

---

## Key Decisions

### 1. Anonymous vs Authenticated Users
**Decision:** Start with anonymous (push subscription as identifier)
**Rationale:** Lower friction, can add auth later
**Trade-off:** Can't sync subscriptions across devices

### 2. Geofence Radius
**Decision:** 150 meters per station
**Rationale:** Covers station + approaching trains
**Trade-off:** May trigger slightly early in dense areas

### 3. Position Update Frequency
**Decision:** Every 15 seconds (match existing polling)
**Rationale:** Already fetching data at this rate
**Trade-off:** ~2,880 updates/train/day (may hit rate limits)

### 4. Approach Alert Trigger
**Decision:** When train enters station geofence
**Rationale:** Simple and reliable
**Alternative:** "2 stops away" requires route awareness

---

## Dependencies

### NPM Packages to Add
```json
{
  "web-push": "^3.6.0"
}
```

### External Services
- TomTom Geofencing API (Public Preview)
- Browser Push Service (FCM/APNs/etc)

---

## Useful Links

- [TomTom Geofencing Intro](https://developer.tomtom.com/geofencing-api/documentation/product-information/introduction)
- [TomTom Notifications API](https://developer.tomtom.com/notifications-api/documentation/product-information/introduction)
- [Web Push Protocol](https://web.dev/push-notifications-overview/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [VAPID Spec](https://datatracker.ietf.org/doc/html/rfc8292)
