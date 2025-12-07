# Geofence Alerts - Task Checklist

**Last Updated: 2025-12-07**

## Phase 1: Foundation

### 1.1 Database Schema [M] [P0]
- [ ] Add `GeofenceAlert` model to `prisma/schema.prisma`
- [ ] Add `TomTomGeofence` model to `prisma/schema.prisma`
- [ ] Run `npx prisma migrate dev --name add-geofence-alerts`
- [ ] Verify migration successful
- [ ] Test creating a subscription record

### 1.2 TomTom Geofencing Project Setup [S] [P0]
- [ ] Create project via TomTom API
- [ ] Note project ID
- [ ] Configure webhook URL in TomTom dashboard
- [ ] Test webhook receives test event

### 1.3 Environment Configuration [S] [P0]
- [ ] Generate VAPID keys: `npx web-push generate-vapid-keys`
- [ ] Add `TOMTOM_GEOFENCING_PROJECT_ID` to `.env`
- [ ] Add `TOMTOM_WEBHOOK_SECRET` to `.env`
- [ ] Add `VAPID_PUBLIC_KEY` to `.env`
- [ ] Add `VAPID_PRIVATE_KEY` to `.env`
- [ ] Add `VAPID_SUBJECT` to `.env`
- [ ] Update `.env.example` with new vars
- [ ] Add secrets to Vercel environment

---

## Phase 2: Geofence Management

### 2.1 TomTom API Client [M] [P0]
- [ ] Create `src/lib/tomtom/geofencing-client.ts`
- [ ] Implement `createProject()`
- [ ] Implement `createFence()`
- [ ] Implement `deleteFence()`
- [ ] Implement `updateObjectPosition()`
- [ ] Implement `getTransitions()`
- [ ] Add TypeScript types for all responses
- [ ] Add error handling and retries
- [ ] Add rate limit handling

### 2.2 Station Geofence Creation Script [L] [P0]
- [ ] Create `scripts/create-station-geofences.ts`
- [ ] Load all stations from database/API
- [ ] Create circle geofence for each station (150m radius)
- [ ] Save geofence IDs to `TomTomGeofence` table
- [ ] Handle rate limiting (10 req/sec max)
- [ ] Add progress logging
- [ ] Handle partial failures gracefully
- [ ] Run script successfully for all 470 stations

### 2.3 Train Position Reporter [L] [P0]
- [ ] Create `src/lib/geofencing/train-reporter.ts`
- [ ] Implement `reportTrainPositions(trains[])`
- [ ] Filter to only moving trains
- [ ] Batch updates for efficiency
- [ ] Integrate with existing train polling in `use-train-positions.ts`
- [ ] Add error logging
- [ ] Add metrics tracking (optional)

---

## Phase 3: Push Notifications

### 3.1 Service Worker [M] [P1]
- [ ] Create `public/sw.js`
- [ ] Handle `push` event
- [ ] Handle `notificationclick` event
- [ ] Add service worker registration in `_app.tsx` or layout
- [ ] Test notification appears on push
- [ ] Test click opens correct URL
- [ ] Verify works in background/closed state

### 3.2 Push Notification Sender [S] [P1]
- [ ] Install `web-push` package
- [ ] Create `src/lib/push/send-notification.ts`
- [ ] Implement `sendPushNotification(subscription, payload)`
- [ ] Handle 410 (subscription expired) response
- [ ] Handle network errors with retry
- [ ] Add logging

### 3.3 Push Subscription API [M] [P1]
- [ ] Create `src/app/api/v1/alerts/subscribe/route.ts`
- [ ] Implement `POST` - create subscription
- [ ] Implement `DELETE` - remove subscription
- [ ] Create `src/app/api/v1/alerts/subscriptions/route.ts`
- [ ] Implement `GET` - list subscriptions by push endpoint
- [ ] Validate push subscription format
- [ ] Add proper error responses

---

## Phase 4: Webhook Handler

### 4.1 Webhook Endpoint [M] [P0]
- [ ] Create `src/app/api/v1/webhooks/tomtom/route.ts`
- [ ] Parse TomTom webhook payload
- [ ] Verify webhook signature
- [ ] Handle `enter` transition events
- [ ] Handle `exit` transition events (optional)
- [ ] Return 200 quickly, process async
- [ ] Add error logging to Sentry

### 4.2 Alert Dispatch Logic [M] [P0]
- [ ] Create `src/lib/alerts/dispatch.ts`
- [ ] Implement `handleTrainApproaching(event)`
- [ ] Look up station from fence ID
- [ ] Look up train details from object ID
- [ ] Query matching subscriptions
- [ ] Send push notification to each
- [ ] Update `lastTriggered` timestamp
- [ ] Add rate limiting (max 1 alert per train per station per 5 min)
- [ ] Handle failed notifications gracefully

---

## Phase 5: User Experience

### 5.1 Subscribe Button Component [M] [P1]
- [ ] Create `src/components/alerts/AlertSubscribeButton.tsx`
- [ ] Request notification permission
- [ ] Get push subscription from service worker
- [ ] POST to subscribe API
- [ ] Show subscribed state
- [ ] Handle permission denied gracefully
- [ ] Add to station detail page

### 5.2 Route Selector (Optional) [S] [P2]
- [ ] Add route filter to subscribe button
- [ ] Allow "All routes" or specific route
- [ ] Pass routeId to subscription API

### 5.3 Subscription Management Page [M] [P2]
- [ ] Create `src/app/(dashboard)/alerts/page.tsx`
- [ ] Fetch subscriptions by push endpoint
- [ ] Display station name and route
- [ ] Toggle active/inactive
- [ ] Delete subscription
- [ ] Add to sidebar navigation

### 5.4 Alert History [S] [P3]
- [ ] Store recent alerts in localStorage
- [ ] Display last 10 alerts
- [ ] Show timestamp and station
- [ ] Clear after 24 hours

---

## Testing & QA

### Integration Tests
- [ ] Create subscription → verify in database
- [ ] Simulate webhook → verify notification sent
- [ ] Delete subscription → verify no notifications

### Manual Testing
- [ ] Subscribe on Chrome desktop
- [ ] Subscribe on Chrome Android
- [ ] Subscribe on Safari iOS (if PWA)
- [ ] Receive notification when train approaches
- [ ] Click notification → opens station page
- [ ] Unsubscribe → no more notifications

---

## Deployment

- [ ] All env vars in Vercel
- [ ] Database migration applied to production
- [ ] Geofences created for all stations
- [ ] Webhook URL accessible from TomTom
- [ ] Test end-to-end in production

---

## Post-Launch

- [ ] Monitor webhook error rate
- [ ] Monitor notification delivery rate
- [ ] Track subscription conversion rate
- [ ] Gather user feedback
- [ ] Optimize position update frequency if needed
