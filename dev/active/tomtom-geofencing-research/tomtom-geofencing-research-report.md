Last Updated: 2025-12-07

# TomTom Geofencing API — Research Report

## Executive Summary

TomTom offers a comprehensive Geofencing API (currently in Public Preview) that enables real-time tracking of objects entering/exiting virtual geographic boundaries. The service supports multiple fence shapes (circles, polygons, rectangles, corridors), provides webhook-based notifications via the Notifications API, and includes a complete suite of REST endpoints for managing projects, fences, objects, and transitions. For transit tracking applications, TomTom provides a freemium tier (2,500 free requests/day) with the ability to track up to 1,000 objects across 10,000 projects, each containing up to 1,000 fences. The API integrates seamlessly with TomTom's Location History API for historical tracking and supports real-time event notifications through webhooks or email.

---

## Detailed Findings

### 1. Geofencing APIs Offered by TomTom

#### Core API Services

**Geofencing API** — The primary service for defining virtual barriers on real geographical locations. Supports determining whether an object is located within, outside, or close to a predefined geographical area.

The API consists of seven interconnected services:

1. **Configuration Service** — Manages user account options and credentials (Admin Key registration)
2. **Projects Service** — Organizes fences into logical groupings for easier administration
3. **Fences Service** — Creates and manages geographic boundaries (circles, polygons, rectangles, corridors)
4. **Objects Service** — Represents entities to be tracked (vehicles, people, devices, packages)
5. **Report Service** — Provides real-time queries to check if an object/point is inside/outside fences
6. **Transitions Service** — Tracks historical events when objects cross fence boundaries
7. **Alert Service** — Creates alert messages sent via the Notifications API

**Notifications API** — Separate but integrated service that handles communication from Maps APIs to users via webhooks or emails. Works in conjunction with the Geofencing Alert Service.

#### Authentication Requirements

- **API Key** — Standard key for accessing TomTom Maps APIs including Geofencing
- **Admin Key** — Special credential for administrative operations (create/edit/delete projects, fences, objects)
  - Requires registration via Configuration service endpoint
  - Protected by a secret (10-30 characters) for regeneration if lost/stolen
  - Never asked for in normal operations

#### API Status

Currently in **Public Preview** as of January 2025. Documentation last updated January 16, 2025.

---

### 2. Creating and Managing Geofences

#### Supported Fence Types

1. **Circle** — Defined by center point (latitude/longitude) and radius in meters
2. **Polygon** — Custom shape with multiple vertices (up to 1,000 vertices per polygon)
3. **Rectangle** — Two-point rectangular boundary
4. **Corridor** — Linear geofence along a route

All fence types support user-defined labels and attributes.

#### Creating Fences: Step-by-Step

**Prerequisites:**
1. Register an Admin Key via Configuration service
2. Create a Project (fences must belong to at least one project)

**Circle Fence Creation:**
```http
POST https://api.tomtom.com/geofencing/1/projects/{projectId}/fence?key={apiKey}&adminKey={adminKey}

Body:
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "shapeType": "Circle",
    "radius": 500,
    "coordinates": [longitude, latitude]
  },
  "properties": {
    "name": "Station Geofence",
    "category": "transit_stop"
  }
}
```

**Polygon Fence Creation:**
```http
POST https://api.tomtom.com/geofencing/1/projects/{projectId}/fence?key={apiKey}&adminKey={adminKey}

Body:
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [lon1, lat1],
        [lon2, lat2],
        [lon3, lat3],
        [lon1, lat1]  // Close the polygon
      ]
    ]
  },
  "properties": {
    "name": "Transit Zone",
    "customAttribute": "value"
  }
}
```

#### Management Operations

- **List fences in a project** — GET endpoint retrieves all fences
- **Delete fence** — Remove from single or multiple projects
- **Update fence** — Modify geometry or properties
- **List objects inside fence** — Query which tracked objects are currently in the fence
- **Get objects count** — Fast count of objects within a fence boundary

#### Geofence Creator Tool

TomTom provides a visual **Geofences Creator** web application:
- URL: https://developer.tomtom.com/demos/geofences-creator/
- Interactive map interface for drawing fences
- Supports all fence types (circle, rectangle, polygon, corridor)
- Can search for POIs or geometry
- Directly integrates with Geofencing API for storage

#### Performance Considerations

- **No surface size limits** on polygons (only precision limits: 0.000001 degree minimum)
- **Polygon complexity** — Surface area has little impact, but vertex count significantly affects response speed
- **GPS accuracy** — Consider that many devices have ~50 feet GPS accuracy when designing fence sizes
- **Best practice** — Simplify polygons when possible to optimize response times

---

### 3. Alerting and Notification System

#### Alert Service Architecture

The Geofencing **Alert Service** creates alert messages triggered by transitions (objects crossing fence boundaries). Alerts are delivered through the **Notifications API** via:
- Email addresses
- Webhook URLs (HTTP POST requests)

#### Transition Events

A **transition** is an event when an object crosses a fence border. The Transitions Service tracks:
- **Entry events** — Object enters a fence
- **Exit events** — Object leaves a fence
- **Timestamp** — When the transition occurred
- **Object details** — Which object triggered the transition
- **Fence details** — Which fence was crossed

#### Notification Delivery Mechanism

**Contact Groups:**
- Created via Notifications API
- Can contain up to 20 webhook URLs per group
- Can contain up to 20 email addresses per group
- Single group can be reused across multiple APIs
- Changes to a group propagate to all APIs using it

**Webhook Setup:**
```http
POST https://api.tomtom.com/notifications/1/groups?key={apiKey}

Body:
{
  "name": "Transit Alerts Group",
  "webhooks": [
    "https://your-app.com/api/geofence-events",
    "https://your-slack-webhook.slack.com/..."
  ],
  "emails": [
    "fleet-manager@example.com"
  ]
}
```

Returns a `groupId` used when setting up alerts.

**Webhook Payload Format:**
When an object crosses a geofence, TomTom sends a POST request to configured webhooks with:
- Transition details (entry/exit, timestamp)
- Object information
- Fence information
- Additional context data

#### Alert Configuration

Alerts are set up to trigger on specific fence/object combinations:
- Define which objects to monitor
- Define which fences should trigger alerts
- Associate with a Contact Group for notification delivery
- Configure entry/exit event preferences

#### Notification History

- Notifications kept for **7 days**
- Accessible via List notifications history endpoint
- Automatically deleted after retention period

---

### 4. Pricing Considerations

#### Freemium Tier

- **2,500 free non-tile requests daily** (includes geofencing operations)
- Available even on Pay As You Grow plan
- No upfront costs to start

#### Beyond Free Tier

- **Geocoding pricing** as reference: ~$0.75 per 1,000 requests beyond free tier
- Credits purchased in advance
- Specific Geofencing API pricing not publicly listed (likely similar model)

#### Rate Limits (QPS)

- **5-50 queries per second** depending on API type
- QPS = Queries Per Second capacity
- **Flexible QPS limits** available in Enterprise contracts
- Contact TomTom sales for higher limits

#### Service Limits (Default)

- **1,000 objects** maximum
- **10,000 projects** maximum
- **1,000 fences per project** maximum
- **1,000 vertices per polygon fence** maximum
- **Custom limits** available by contacting TomTom licensing assistant

#### Data Retention & Storage

- **Active transition data** — 3 months
- **Cold archive transition data** — Additional 6 months (9 months total)
- **Automatic deletion** — Accounts inactive for 180 days may have geofencing data deleted
- **Notification history** — 7 days retention

#### Cost Optimization Strategies

1. Simplify polygon fences to reduce vertex count (improves performance, may reduce costs)
2. Use Report Service for on-demand checks vs. continuous tracking
3. Leverage Contact Groups to manage webhook destinations efficiently
4. Archive important transition data locally before 3-month active retention expires

---

### 5. Webhooks and Real-Time Event Notifications

#### Webhook Capabilities

**Automated Event Delivery:**
Webhooks send HTTP POST requests instantly when transitions occur. No polling required — the application receives data as soon as it's available.

**Integration Options:**
- Custom application endpoints
- Slack channels
- Microsoft Teams channels
- Third-party webhook services
- Database logging systems

#### Real-Time Event Flow

1. **Object Position Update** — Your application sends object location to Geofencing API
2. **Transition Detection** — TomTom detects fence boundary crossing
3. **Alert Triggered** — Alert Service generates notification
4. **Webhook Fired** — Notifications API sends POST to all configured webhooks
5. **Application Response** — Your app processes the event and takes action

#### Webhook Configuration Best Practices

**Security:**
- Implement webhook signature verification
- Use HTTPS endpoints only
- Validate incoming payload structure

**Reliability:**
- Return 200 OK quickly to acknowledge receipt
- Process events asynchronously (queue for background processing)
- Implement retry logic for failed processing

**Monitoring:**
- Log all incoming webhook events
- Track delivery success/failure rates
- Use Notification History API to audit deliveries

#### Alternative: Report Service (On-Demand Queries)

For applications that don't need real-time webhooks, the **Report Service** provides synchronous position checking:

```http
POST https://api.tomtom.com/geofencing/1/report/{projectId}?key={apiKey}&point={lon,lat,alt}&object={objectId}&range={meters}

Response:
{
  "fencesInside": [...],      // Fences the object is currently inside
  "fencesOutside": [...],     // Nearby fences within range (not inside)
  "distances": {...}          // Distance to nearest fence borders
}
```

**Use cases for Report Service:**
- Periodic position checks (e.g., every 30 seconds)
- On-demand queries when user requests status
- Applications with lower frequency requirements
- Reducing webhook volume for high-traffic scenarios

---

### 6. Typical Implementation Pattern

#### Implementation Architecture for Transit Tracking

**Step 1: Initial Setup**
1. Register for TomTom Developer account
2. Generate API Key and Admin Key from dashboard
3. Register Admin Key via Configuration Service POST endpoint
4. Create Notification Contact Group(s) with webhook URLs

**Step 2: Project and Fence Creation**
1. Create Project(s) for organizing transit stops/zones
2. Define geofences for each transit station/stop:
   - Circle fences for point locations (e.g., 100m radius around station)
   - Polygon fences for complex zones (e.g., depot boundaries)
   - Corridor fences for route segments (optional)
3. Assign custom properties (station ID, route number, zone type)

**Step 3: Object Registration**
1. Create Object for each tracked vehicle/asset
2. Link objects to configuration
3. Set default project associations

**Step 4: Real-Time Tracking Integration**

**Client-Side (Vehicle/Device):**
```javascript
// Periodically send position updates
const updateVehiclePosition = async (vehicleId, lat, lon) => {
  const response = await fetch(
    `https://api.tomtom.com/geofencing/1/objects/${vehicleId}/position?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: lat,
        longitude: lon,
        timestamp: new Date().toISOString()
      })
    }
  );
  return response.json();
};

// Update every 10-30 seconds while moving
setInterval(() => {
  navigator.geolocation.getCurrentPosition((pos) => {
    updateVehiclePosition(
      vehicleId,
      pos.coords.latitude,
      pos.coords.longitude
    );
  });
}, 15000);
```

**Server-Side (Webhook Handler):**
```javascript
// Express endpoint to receive geofence transition events
app.post('/api/geofence-events', async (req, res) => {
  const { objectId, fenceId, transitionType, timestamp } = req.body;

  // Acknowledge receipt immediately
  res.status(200).send('OK');

  // Process asynchronously
  processTransitionEvent({
    vehicleId: objectId,
    stationId: fenceId,
    eventType: transitionType, // 'enter' or 'exit'
    time: timestamp
  });
});

const processTransitionEvent = async (event) => {
  if (event.eventType === 'enter') {
    // Vehicle arrived at station
    await notifyPassengers(event.vehicleId, event.stationId, 'arrived');
    await updateETACalculations(event.vehicleId);
  } else if (event.eventType === 'exit') {
    // Vehicle departed station
    await notifyPassengers(event.vehicleId, event.stationId, 'departed');
    await startNextStationETA(event.vehicleId);
  }

  // Log to database
  await db.transitEvents.insert(event);
};
```

**Step 5: Alert Configuration**
1. Create alerts linking objects to fences
2. Associate alerts with Contact Groups
3. Configure entry/exit event preferences

**Step 6: Historical Analysis**

Query transitions for reporting:
```javascript
// Get all transitions for a vehicle in the last 24 hours
const getVehicleHistory = async (vehicleId) => {
  const yesterday = Date.now() - 86400000;
  const now = Date.now();

  const response = await fetch(
    `https://api.tomtom.com/geofencing/1/transitions/objects/${vehicleId}?key=${apiKey}&from=${yesterday}&to=${now}`
  );

  return response.json();
};

// Analyze route compliance, dwell times, on-time performance
const analyzePerformance = (transitions) => {
  return transitions.map(t => ({
    station: t.fenceId,
    arrivalTime: t.entryTime,
    departureTime: t.exitTime,
    dwellTime: t.exitTime - t.entryTime
  }));
};
```

#### Framework-Specific Patterns

**React Implementation:**
- Use `useEffect` hook to initialize TomTom Maps SDK
- Create geofences with Axios POST requests
- Store fence IDs in component state or Redux/Zustand
- Add map click handlers to create fences interactively
- Display fence polygons/circles on TomTom Map layer

**Vue Implementation:**
- Similar pattern with Vue lifecycle hooks
- Leverage Vue's reactive state management
- Store geofence data in Vuex or Pinia

**Angular Implementation:**
- Use services for Geofencing API communication
- RxJS observables for webhook event streams
- Dependency injection for API key management

**Mobile (Android SDK):**
```java
// TomTom provides native Android Geofencing module
TTGeofencingReportQuery reportQuery = new TTGeofencingReportQueryBuilder()
    .withLocation(new TTLocation(coordinate))
    .withProject(projectId)
    .withRange(range)
    .build();

geofencingService.report(reportQuery, callback);
```

#### Common Integration Patterns

**Pattern 1: Station Arrival/Departure Tracking**
- Create circle geofence (100-200m radius) around each station
- Vehicle enters → trigger "arriving" notification
- Vehicle exits → trigger "departed" notification
- Use transitions for on-time performance analytics

**Pattern 2: Route Compliance Monitoring**
- Create corridor geofences along approved routes
- Alert if vehicle exits corridor (route deviation)
- Track time spent outside designated areas

**Pattern 3: Depot/Yard Management**
- Polygon geofences for depot boundaries
- Track vehicle entry/exit for shift management
- Monitor after-hours movements

**Pattern 4: Dynamic ETA Updates**
- Combine Geofencing with Routing API
- Recalculate ETA when vehicle enters proximity geofence
- Send updated arrival times to passengers via Notifications API

**Pattern 5: Zone-Based Analytics**
- Create geofences for service zones (downtown, suburbs, airport)
- Analyze time spent per zone
- Optimize fleet allocation based on zone demand

---

## API Endpoint Reference

### Configuration Service
```
POST /geofencing/1/configuration/adminkey/register
  - Register Admin Key with secret
```

### Projects Service
```
POST /geofencing/1/projects
  - Create new project

GET /geofencing/1/projects/{projectId}
  - Get project details including fences

DELETE /geofencing/1/projects/{projectId}
  - Delete project
```

### Fences Service
```
POST /geofencing/1/projects/{projectId}/fence
  - Create fence in project

GET /geofencing/1/projects/{projectId}/fences
  - List all fences in project

DELETE /geofencing/1/fences/{fenceId}/projects/{projectId}
  - Remove fence from project

GET /geofencing/1/fences/{fenceId}/objects
  - List objects currently inside fence
```

### Objects Service
```
POST /geofencing/1/objects
  - Create new object to track

POST /geofencing/1/objects/{objectId}/position
  - Update object position

GET /geofencing/1/objects/{objectId}
  - Get object details

DELETE /geofencing/1/objects/{objectId}
  - Delete object
```

### Report Service
```
POST /geofencing/1/report/{projectId}?point={lon,lat,alt}&object={objectId}&range={meters}
  - Get real-time report of fences object is inside/near
```

### Transitions Service
```
GET /geofencing/1/transitions/objects/{objectId}?from={timestamp}&to={timestamp}
  - Get all transitions for specific object

GET /geofencing/1/transitions/fences/{fenceId}?from={timestamp}&to={timestamp}
  - Get all transitions for specific fence

GET /geofencing/1/transitions/projects/{projectId}?from={timestamp}&to={timestamp}
  - Get all transitions for fences in project
```

### Alert Service
```
POST /geofencing/1/alerts
  - Create alert linking object, fence, and contact group

GET /geofencing/1/alerts
  - List configured alerts

DELETE /geofencing/1/alerts/{alertId}
  - Delete alert
```

### Notifications API (Contact Groups)
```
POST /notifications/1/groups
  - Create contact group with webhooks/emails

GET /notifications/1/groups
  - List all contact groups

PATCH /notifications/1/groups/{groupId}
  - Partially update contact group

DELETE /notifications/1/groups/{groupId}
  - Delete contact group

GET /notifications/1/notifications
  - List notification history (7 day retention)
```

---

## Sources & References

### Official Documentation
- [Introduction | Geofencing API | TomTom Developer Portal](https://developer.tomtom.com/geofencing-api/documentation/product-information/introduction)
- [Geofencing API Release Notes](https://developer.tomtom.com/geofencing-api/documentation/product-information/release-notes)
- [Objects Service Documentation](https://developer.tomtom.com/geofencing-api/documentation/objects-service/objects-service)
- [Configuration Service Documentation](https://developer.tomtom.com/geofencing-api/documentation/configuration-service/configuration-service)
- [Fences Service Documentation](https://developer.tomtom.com/geofencing-api/documentation/fences-service/fences-service)
- [Custom Fence Shapes](https://developer.tomtom.com/geofencing-api/documentation/fences-service/custom-fence-shapes)
- [Transitions Service Documentation](https://developer.tomtom.com/geofencing-api/documentation/transitions-service/transitions-service)
- [Report Service Documentation](https://developer.tomtom.com/geofencing-api/documentation/report-service/report-service)
- [Alert Service Documentation](https://developer.tomtom.com/geofencing-api/documentation/alert-service/alert-service)
- [Introduction | Notifications API](https://developer.tomtom.com/notifications-api/documentation/product-information/introduction)
- [Contact Groups Service](https://developer.tomtom.com/notifications-api/documentation/contact-groups-service/contact-groups-service)
- [Notification Format](https://developer.tomtom.com/notifications-api/documentation/notification-format/notification-format)

### Tools & Demos
- [Geofences Creator Tool](https://developer.tomtom.com/geofencing-api/documentation/geofences-creator)
- [Live Geofences Creator Demo](https://developer.tomtom.com/demos/geofences-creator/)

### Tutorials & Blog Posts
- [Getting Started with the TomTom Geofencing Service](https://developer.tomtom.com/blog/build-different/getting-started-tomtom-geofencing-service/)
- [Creating and Using TomTom Geofences with React](https://developer.tomtom.com/blog/build-different/creating-and-using-tomtom-geofences-react/)
- [Creating and Using TomTom Geofences with Angular](https://developer.tomtom.com/blog/build-different/creating-and-using-tomtom-geofences-angular/)
- [Creating and Using TomTom Geofences with Vue](https://developer.tomtom.com/blog/build-different/creating-and-using-tomtom-geofences-vue/)
- [Advanced Geofencing with TomTom Maps](https://developer.tomtom.com/blog/decoded/advanced-geofencing-tomtom-maps/)
- [Creating Geofences with GeoJSON](https://developer.tomtom.com/blog/build-different/creating-geofences-geojson-define-virtual-borders/)

### Use Case Examples
- [Fleet Management with TomTom Geocoding and Geofencing Services](https://developer.tomtom.com/blog/decoded/fleet-management-tomtom-geocoding-and-geofencing-services/)
- [How Location APIs can help power Fleet Management Software](https://developer.tomtom.com/blog/decoded/how-location-apis-can-help-power-fleet-management-software/)
- [Leverage Routing, Geofencing, and Notifications APIs to Send ETA Alerts](https://developer.tomtom.com/blog/build-different/leverage-routing-geofencing-and-notifications-apis-send-eta-alerts/)
- [Putting the TomTom Location History and Geofencing APIs to Work](https://developer.tomtom.com/blog/build-different/putting-tomtom-location-history-and-geofencing-apis-work/)
- [Create a Geomarketing Mobile Application Using TomTom Geofencing](https://developer.tomtom.com/blog/decoded/create-geomarketing-mobile-application-using-tomtom-geofencing/)
- [Using Data Science to Analyze and Visualize TomTom Notification Data](https://developer.tomtom.com/blog/build-different/using-data-science-analyze-and-visualize-tomtom-notification-data/)

### Pricing & Limits
- [TomTom Pricing Page](https://developer.tomtom.com/pricing)
- [Geofencing API FAQ - Limitations](https://developer.tomtom.com/knowledgebase/apis/faq/geofencing/)
- [QPS Management Documentation](https://developer.tomtom.com/platform/documentation/dashboard/qps-management)

### API References
- [Get Fences Transitions Endpoint](https://developer.tomtom.com/geofencing-api/documentation/transitions-service/get-fences-transitions)
- [Get Objects Transitions Endpoint](https://developer.tomtom.com/geofencing-api/documentation/transitions-service/get-objects-transitions)
- [Report Request Endpoint](https://developer.tomtom.com/geofencing-api/documentation/report-service/report-request)
- [Get Project Details Endpoint](https://developer.tomtom.com/geofencing-api/documentation/projects-service/get-project-details)

---

## Recommendations for Transit Tracking Application

### Primary Recommendation: Full Integration with Webhook-Based Alerts

**Rationale:**
TomTom's Geofencing API provides the exact capabilities needed for transit tracking:
1. Real-time arrival/departure detection via geofence transitions
2. Automatic webhook notifications eliminate polling overhead
3. Support for 1,000 concurrent vehicles (objects) on standard tier
4. Freemium tier (2,500 requests/day) sufficient for initial development/testing
5. Integrated with TomTom Maps SDK for unified mapping experience

**Implementation Approach:**
1. **Phase 1 - Setup (Week 1)**
   - Register API/Admin keys
   - Create projects for transit lines/routes
   - Define circle geofences (100-150m radius) for each station
   - Set up webhook endpoint in your backend
   - Create notification contact groups

2. **Phase 2 - Vehicle Tracking (Week 2-3)**
   - Implement position update mechanism from vehicles (15-30 second intervals)
   - Configure alerts for all vehicle-station combinations
   - Build webhook handler for transition events
   - Integrate with real-time database (Firebase/Postgres) for state management

3. **Phase 3 - Passenger Features (Week 4-5)**
   - Display real-time vehicle positions on map
   - Show arrival/departure notifications to passengers
   - Implement ETA calculations using Routing API
   - Add historical performance analytics using Transitions API

4. **Phase 4 - Optimization (Week 6+)**
   - Analyze transition data for route compliance
   - Optimize geofence sizes based on GPS accuracy
   - Implement caching for frequently accessed fence data
   - Add offline support for vehicles (queue position updates)

### Alternative Approaches

#### Alternative A: Report Service Polling (Lower Real-Time Requirements)

**When to use:**
- Budget-constrained projects (minimize webhook infrastructure costs)
- Lower frequency updates acceptable (30-60 second intervals)
- Simpler architecture without webhook handling

**Implementation:**
- Poll Report Service every 30 seconds for each vehicle
- Check if vehicle is inside station geofences
- Detect transitions by comparing current vs. previous state
- Lower API request volume compared to position updates + webhooks

**Trade-offs:**
- Delayed notifications (up to polling interval)
- Higher client-side complexity (transition detection logic)
- Potential for missed rapid transitions
- May exceed free tier faster due to frequent polling

#### Alternative B: Hybrid Approach (Critical + Non-Critical Zones)

**When to use:**
- Large service area with many zones
- Need real-time alerts only for key locations (stations, depots)
- Cost optimization while maintaining core functionality

**Implementation:**
- Configure webhook alerts for critical geofences (stations, major stops)
- Use Report Service polling for non-critical zones (route segments, service areas)
- Reduces webhook volume while maintaining real-time station notifications

**Trade-offs:**
- More complex logic (two tracking mechanisms)
- Requires careful zone categorization
- Best for applications with clear critical/non-critical distinction

### Cost Projection for Transit Application

**Assumptions:**
- 50 vehicles tracked
- 100 station geofences
- Position updates every 15 seconds (4 updates/minute)
- Average 10 station visits per vehicle per day

**Daily API Calls:**
- Position updates: 50 vehicles × 4/min × 60 min × 16 hours = 192,000 requests/day
- Transitions queries: 50 vehicles × 10 stations × 2 (entry/exit) = 1,000 transitions/day
- Webhook deliveries: ~1,000 (included in Notifications API, not Geofencing requests)

**Estimated Cost:**
- Free tier covers: 2,500 requests/day
- Paid requests: 189,500/day
- Monthly requests: ~5.7M
- Estimated cost: (5,700,000 / 1,000) × $0.75 = ~$4,275/month

**Cost Optimization:**
- Reduce update frequency to 30 seconds: ~$2,137/month (50% reduction)
- Update only when moving (skip stationary vehicles): Additional 30-50% reduction
- Use geofence proximity to increase update frequency only near stations
- Estimated optimized cost: $1,000-$1,500/month for 50-vehicle fleet

**Note:** Contact TomTom sales for Enterprise pricing which may offer volume discounts for high-traffic applications.

---

## Additional Notes

### Conflicting Information & Resolution

**Public Preview Status:**
The API is marked as "Public Preview" which typically indicates:
- Not yet production-ready for all use cases
- Potential breaking changes in future updates
- May have undiscovered bugs or limitations
- Support may be limited compared to GA (Generally Available) services

**Resolution:** Monitor the Release Notes page regularly for updates. Plan for potential migration work when API reaches GA. Consider building abstraction layer to isolate Geofencing API calls for easier future updates.

**Data Retention Ambiguity:**
- Active transition data: 3 months (clear)
- Cold archive: Additional 6 months (9 months total)
- Access method for cold archive data not clearly documented

**Resolution:** If historical data beyond 3 months is critical, implement your own archival system by regularly querying and storing transition data. Don't rely solely on TomTom's cold archive until access methods are confirmed.

### Open Questions for TomTom Sales/Support

1. **Cold Archive Access:** How do we query transition data from the 6-month cold archive? Are there additional costs?

2. **Webhook Reliability:** What is the SLA for webhook delivery? Are there retry mechanisms if our endpoint is temporarily down?

3. **Position Update Frequency:** What is the recommended minimum interval between position updates to avoid rate limiting? Is there a maximum update frequency?

4. **Enterprise Pricing:** What are the volume discount tiers for high-traffic applications (>100k requests/day)?

5. **Public Preview Timeline:** When is General Availability expected? What breaking changes should we anticipate?

6. **Scalability Limits:** Can the 1,000 object limit be increased for Enterprise customers? What about the 1,000 fences per project limit?

7. **Webhook Authentication:** Does TomTom sign webhook payloads for verification? If so, what algorithm/header is used?

8. **Offline Support:** If a vehicle loses connectivity, can queued position updates be batch-uploaded when connection resumes?

9. **Multi-Region Support:** Are there regional API endpoints for reduced latency (e.g., EU, Asia-Pacific)?

10. **Audit Logging:** Are there APIs to retrieve audit logs of admin operations (fence creation/deletion, object management)?

### Integration with Other TomTom Services

**Location History API:**
- Complements Geofencing by storing complete position history
- Query historical routes and positions
- Combine with geofence transitions for complete trip analytics
- Useful for compliance reporting and route optimization

**Routing API:**
- Calculate ETAs to next geofence
- Optimize routes considering geofence constraints
- Trigger dynamic alerts based on proximity to geofence + current route

**Traffic API:**
- Adjust ETA calculations based on real-time traffic
- Send proactive delay notifications before vehicle reaches geofence
- Route vehicles around congestion while respecting geofence boundaries

**Search API:**
- Find POIs near geofences
- Auto-generate geofences around search results
- Enable location-based service discovery for passengers

### Security Considerations

1. **API Key Protection:**
   - Never expose Admin Key in client-side code
   - Use environment variables or secure key management service
   - Rotate keys periodically

2. **Webhook Endpoint Security:**
   - Implement IP whitelisting for TomTom webhook sources
   - Use HTTPS only
   - Validate payload structure before processing
   - Implement request signing verification (if TomTom provides)

3. **Data Privacy:**
   - Anonymize object IDs when possible
   - Implement data retention policies aligned with privacy regulations (GDPR, CCPA)
   - Provide opt-out mechanisms for location tracking

4. **Rate Limiting:**
   - Implement application-level rate limiting to avoid exceeding QPS
   - Queue position updates during high-traffic periods
   - Monitor API usage dashboards to detect anomalies

### Next Research Steps

1. **Test Implementation:**
   - Build proof-of-concept with 2-3 vehicles and 5 stations
   - Validate webhook delivery reliability
   - Measure actual position update frequency requirements
   - Test transition detection accuracy with varying geofence sizes

2. **Performance Benchmarking:**
   - Test Report Service response times with varying object counts
   - Measure webhook delivery latency
   - Evaluate polygon complexity impact on performance
   - Determine optimal position update intervals

3. **Alternative Solutions Comparison:**
   - Research Google Maps Geofencing API capabilities
   - Evaluate AWS Location Service geofencing features
   - Compare pricing, features, and integration complexity
   - Consider open-source geofencing libraries (e.g., Turf.js with self-hosted logic)

4. **Legal & Compliance Review:**
   - Review TomTom Terms of Service for transit tracking use case
   - Verify data residency requirements (where is data stored?)
   - Confirm GDPR/privacy compliance features
   - Understand liability for service outages

5. **Technical Deep-Dive:**
   - Test Geofencing API with TomTom Maps SDK for Web integration
   - Evaluate mobile SDK geofencing modules (Android/iOS)
   - Prototype React implementation following TomTom tutorials
   - Assess integration with existing mapping solution (if any)

---

## Summary for Transit Tracking Implementation

TomTom's Geofencing API is **well-suited for transit tracking applications** with the following key advantages:

**Strengths:**
- Comprehensive REST API with all necessary services (projects, fences, objects, transitions, alerts)
- Real-time webhook notifications eliminate polling
- Support for multiple fence shapes (circles ideal for stations)
- Generous free tier for development/testing (2,500 requests/day)
- Integration with broader TomTom ecosystem (maps, routing, traffic)
- Visual Geofence Creator tool for easy fence setup
- 3-month transition history for analytics
- Scalable to 1,000 objects (vehicles) and 10,000 projects

**Limitations:**
- Public Preview status (not yet production GA)
- Pricing can scale quickly with frequent position updates (optimize update intervals)
- 7-day notification history (implement own logging if longer retention needed)
- Cold archive access methods unclear (need clarification from TomTom)
- QPS limits may require Enterprise plan for high-traffic deployments

**Recommended Architecture:**
1. Create project per transit line/route
2. Define circle geofences (100-150m) around each station
3. Create object for each vehicle
4. Send position updates every 15-30 seconds (optimized based on proximity to stations)
5. Configure webhook alerts for all vehicle-station transitions
6. Process webhooks asynchronously in backend
7. Store transitions in database for analytics
8. Display real-time positions on TomTom Maps SDK
9. Calculate ETAs using Routing API + current position + upcoming geofences

This approach provides real-time arrival/departure tracking, historical analytics, and seamless integration with TomTom's mapping platform, making it a strong candidate for transit tracking applications.
