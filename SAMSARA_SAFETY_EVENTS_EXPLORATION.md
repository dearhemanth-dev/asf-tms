# Samsara Safety Events API Exploration
**Goal:** Replace arbitrary seed data (harsh braking/acceleration) with real Samsara data using G-force physics + manager-friendly language

**Last Updated:** 2026-07-06

---

## Current Problem: Seeded Harsh Braking/Acceleration

### What We Generate Now (❌ Arbitrary)
```typescript
{
  event_type: "harsh_brake_incident",
  details: {
    severity: ["high", "moderate", "low"][i % 3],           // Index-based guess (wrong!)
    location: ["I-5 Exit 42", "US-101 Mile 15"][i % 3],    // Hardcoded generic (wrong!)
    speed: 55 + Math.floor(Math.random() * 20),            // Random (wrong!)
    description: "Rapid deceleration event"                 // Generic (not actionable)
  }
}
```

**Problems:**
- ❌ Severity = first event always "high", then cycles through arbitrary labels
- ❌ Location = hardcoded strings, not real GPS
- ❌ Speed = random, not real vehicle telemetry
- ❌ Description = meaningless to manager

**Manager Impact:** 
"Why was it marked 'high severity'? What should the driver do differently?"

---

## What Real Samsara Provides: Safety Events API

### Option 1: `/safety-events/stream` (Real-time Streaming)
**Scope:** Safety Events & Scores  
**Use Case:** Real-time alerts (not ideal for daily analytics)  
**Stream Payload:**
```json
{
  "id": "se_1234567890",
  "eventType": "harshBraking",
  "occurredAtMs": 1719273600000,
  "vehicle": {
    "id": "vehicle_123",
    "name": "T-001"
  },
  "driver": {
    "id": "driver_456",
    "name": "John Smith"
  },
  "gForceMagnitude": 0.87,
  "speedMph": 65,
  "location": {
    "latitude": 45.5152,
    "longitude": -122.6784
  }
}
```

**Pros:** Real-time, complete data
**Cons:** Requires persistent WebSocket connection; overkill for daily reporting

---

### Option 2: `/safety-events` (Batch Query) ✅ RECOMMENDED
**Scope:** Safety Events & Scores  
**Use Case:** Backfill historical data for daily heatmap  
**Query Filters:** `startTime`, `endTime`, `vehicleIds`, `driverIds` (optional limit)  

**Batch Payload Example:**
```json
{
  "data": [
    {
      "id": "se_1234567890",
      "eventType": "harshBraking",
      "occurredAt": "2026-07-06T17:23:10Z",
      "vehicle": {
        "id": "vehicle_123",
        "name": "T-001"
      },
      "driver": {
        "id": "driver_456",
        "name": "John Smith"
      },
      "gForceMagnitude": 0.87,
      "speedMph": 65,
      "location": {
        "latitude": 45.5152,
        "longitude": -122.6784
      },
      "durationSeconds": 1.2,
      "scores": {
        "severity": 8.5,
        "coachingOpportunity": 9.0
      }
    },
    {
      "id": "se_1234567891",
      "eventType": "harshAcceleration",
      "occurredAt": "2026-07-06T18:15:45Z",
      "vehicle": {"id": "vehicle_123", "name": "T-001"},
      "driver": {"id": "driver_456", "name": "John Smith"},
      "gForceMagnitude": 0.65,
      "speedMph": 35,
      "location": {
        "latitude": 45.5198,
        "longitude": -122.6751
      },
      "durationSeconds": 0.8,
      "scores": {
        "severity": 6.5,
        "coachingOpportunity": 7.0
      }
    }
  ],
  "pagination": {
    "endCursor": "cursor_123",
    "hasNextPage": false
  }
}
```

**Pros:**
- ✅ Perfect for daily analytics
- ✅ Includes G-force (real physics metric)
- ✅ Includes real speed + GPS coordinates
- ✅ Includes severity score (0-10)
- ✅ Supports batch filtering (entire fleet, specific date range)

**Cons:**
- Requires pagination handling for large fleets
- Rate limiting: 1000 requests/minute (OK for our use case)

---

## Translation: Seed Data → Real Samsara Data

### Harsh Braking Example

#### ❌ What We Generate Now
```typescript
severity: "high",           // Wrong: index-based
location: "I-5 Exit 42",   // Wrong: hardcoded
speed: 72,                 // Wrong: random
description: "Rapid deceleration event"  // Wrong: meaningless
```

#### ✅ What Real Samsara Provides
```typescript
gForceMagnitude: 0.87      // Real physics: 0.87G deceleration
speedMph: 65               // Real telemetry
occurredAt: "2026-07-06T17:23:10Z"  // Real timestamp
location: {latitude: 45.5152, longitude: -122.6784}  // Real GPS
scores: {severity: 8.5, coachingOpportunity: 9.0}  // Samsara's assessment
```

#### 🎯 What Manager Sees (Manager-Friendly Translation)
```
Location: Portland, OR (downtown local streets)
Time: 5:23 PM (late shift)
Speed: 65 mph on 35 mph zone ← UNEXPECTED!
Braking Force: 0.87G (very strong)
Coaching: "Hard braking on city streets—possible tailgating or poor spacing"
Severity: HIGH (8.5/10 by Samsara + context shows risky scenario)
```

---

## Severity Inference: G-Force Thresholds

**Problem:** Samsara provides `gForceMagnitude` and `scores.severity` (0-10), but we need our own logic for consistency with speeding/idling.

**Proposed Thresholds (Physics-Based):**

| G-Force | Truck Context | Severity | Manager Coaching |
|---------|---------------|----------|------------------|
| ≥ 0.85G | Emergency stop, ABS activation | HIGH | "Emergency braking—improves planning/spacing" |
| 0.65–0.85G | Hard but controlled braking | MODERATE | "Firm braking—smooth out transitions" |
| < 0.65G | Normal/gentle braking | LOW | "Good braking control" |

**Why G-force?**
- ✅ Objective physics (passenger comfort, brake wear, cargo shifting)
- ✅ Internationally understood (0.85G ≈ "feels like sudden stop")
- ✅ Non-judgmental (easier for coaching conversation)
- ✅ No arbitrary guessing

---

## Manager-Friendly Description Pattern

**Goal:** Replace "Rapid deceleration event" with actionable insight

### Pattern
```
[Road Context] [Time of Day] [Action] [Measurement] [Coaching]
```

### Examples

#### Harsh Braking
```
"0.87G hard braking on local streets at 5:23 PM—watch spacing"
"0.72G firm braking during heavy traffic on I-5—good recovery"
```

#### Harsh Acceleration
```
"0.68G acceleration after traffic light on US-101—smooth start"
"0.55G moderate acceleration at freeway merge—controlled"
```

### Data Mapping
```typescript
const roadType = determineRoadType(coordinates);  // Interstate vs Highway vs Local
const timeOfDay = hour < 6 ? "early shift" : hour < 18 ? "mid-day" : "late shift";
const gForce = parseFloat(event.gForceMagnitude).toFixed(2);
const speed = event.speedMph;
const coachingTip = getCoachingByContext(roadType, gForce, speed);

description = `${gForce}G ${eventType} on ${roadType} at ${timeOfDay}—${coachingTip}`;
```

---

## Implementation Plan

### Step 1: Add Samsara Safety Events Endpoint
**File:** `src/lib/fleet/fetch-samsara-safety-events.ts` (NEW)

```typescript
import fetch from "node-fetch";

interface SamsaraSafetyEvent {
  id: string;
  eventType: "harshBraking" | "harshAcceleration" | "harshCornering";
  occurredAt: string;  // ISO timestamp
  vehicle: { id: string; name: string };
  driver: { id: string; name: string };
  gForceMagnitude: number;
  speedMph: number;
  location: { latitude: number; longitude: number };
  durationSeconds: number;
  scores: { severity: number; coachingOpportunity: number };
}

export async function fetchSamsaraSafetyEvents(
  token: string,
  options: {
    startTime: string;  // ISO timestamp
    endTime: string;
    vehicleIds?: string[];
    driverIds?: string[];
    limit?: number;
  }
): Promise<SamsaraSafetyEvent[]> {
  const params = new URLSearchParams({
    startTime: options.startTime,
    endTime: options.endTime,
    limit: String(options.limit ?? 500),
  });

  if (options.vehicleIds?.length) {
    params.append("vehicleIds", options.vehicleIds.join(","));
  }
  if (options.driverIds?.length) {
    params.append("driverIds", options.driverIds.join(","));
  }

  const response = await fetch(
    `https://api.samsara.com/safety-events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`Samsara safety-events request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data: SamsaraSafetyEvent[];
    pagination?: { hasNextPage: boolean; endCursor?: string };
  };

  return data.data ?? [];
}
```

### Step 2: Map Samsara → Seed Event Format
**File:** `src/lib/analytics/seed-demo-data.ts` (MODIFY)

Replace hardcoded harsh braking/acceleration with real data mapper:

```typescript
function mapSamsaraToEventDetail(
  safetyEvent: SamsaraSafetyEvent
): EventDetail["details"] {
  // Determine road type from coordinates
  const roadType = determineRoadType(
    safetyEvent.location.latitude,
    safetyEvent.location.longitude
  );

  // Calculate severity from G-force (physics-based, not arbitrary)
  const gForce = safetyEvent.gForceMagnitude;
  const severity =
    gForce >= 0.85 ? "high" : gForce >= 0.65 ? "moderate" : "low";

  // Time of day coaching
  const hour = new Date(safetyEvent.occurredAt).getHours();
  const timeContext =
    hour < 6 ? "early shift" : hour < 18 ? "mid-day" : "late shift";

  // Coaching message by context
  const coachingTip =
    safetyEvent.eventType === "harshBraking"
      ? "watch spacing—improve planning"
      : "smooth acceleration—focus smooth";

  return {
    severity,
    location: roadType,
    speed: safetyEvent.speedMph,
    gforce_magnitude: gForce,
    duration_seconds: safetyEvent.durationSeconds,
    description: `${gForce.toFixed(2)}G ${safetyEvent.eventType} on ${roadType} at ${timeContext}—${coachingTip}`,
    samsara_severity_score: safetyEvent.scores.severity,
  };
}
```

### Step 3: Update EventDetail Interface
**File:** `src/lib/analytics/incident-heatmap.ts` (MODIFY)

Add G-force field:

```typescript
export interface EventDetail {
  details: {
    severity?: string;
    location?: string;
    speed?: number;
    gforce_magnitude?: number;  // NEW: Add this
    duration_seconds?: number;  // NEW: Add this
    samsara_severity_score?: number;  // NEW: Add this
    description?: string;
    // ... existing fields
  };
}
```

### Step 4: Update Heatmap Display
**File:** `src/components/IncidentHeatmap.tsx` (MODIFY)

Show G-force prominently for harsh events:

```typescript
{event.event_type === "harsh_brake_incident" ||
event.event_type === "harsh_accel_incident" ? (
  <span className="text-slate-400 flex-1">
    {event.details.gforce_magnitude && (
      <>
        <span className="font-medium text-rose-300">
          {event.details.gforce_magnitude.toFixed(2)}G
        </span>{" "}
        at{" "}
        <span className="font-medium text-rose-300">
          {event.details.speed} mph
        </span>
        {event.details.location ? (
          <>
            {" on "}
            <span className="text-slate-300">{event.details.location}</span>
          </>
        ) : null}
      </>
    )}
  </span>
) : null}
```

Example output: **0.87G at 65 mph on local streets**

---

## API Integration: Real-Time vs Batch

### Decision Tree

```
Are we backfilling historical data for analytics report?
  └─ YES → Use /safety-events (batch query) ✅ RECOMMENDED
            - Query by date range + vehicle/driver filters
            - Process 500-1000 events per request
            - Integrate into daily seed-demo endpoint

Are we building real-time alert system?
  └─ YES → Use /safety-events/stream (WebSocket)
            - Subscribe to vehicle/driver safety events
            - Emit push notifications to manager
            - Handle connection lifecycle
```

**For ASF TMS (analytics-focused):** Use `/safety-events` batch endpoint.

---

## Samsara API Authentication

**Required:**
1. Samsara API key with "Safety Events" + "Scores" scopes
2. Store in `organizations.samsara_api_key` (already exists)
3. Include in Bearer token header

**Testing Endpoint:**
```bash
curl -X GET "https://api.samsara.com/safety-events?startTime=2026-07-05T00:00:00Z&endTime=2026-07-06T23:59:59Z&limit=100" \
  -H "Authorization: Bearer YOUR_SAMSARA_API_KEY" \
  -H "Accept: application/json"
```

---

## Manager Language Examples

### Before (Current Seed Data)
```
Event: Harsh Braking
Severity: High (why? index-based guess)
Location: I-5 Exit 42 (generic, hardcoded)
Speed: 72 mph (random)
Description: Rapid deceleration event
Manager Question: "What happened here? Is this safety-critical?"
```

### After (Real Samsara Data)
```
Event: Harsh Braking
Severity: High (because 0.87G is emergency-level physics)
Location: Portland, OR (real GPS, reverse-geocoded)
Speed: 65 mph in 35 mph zone (context shows unexpected scenario)
Time: 5:23 PM (late shift, fatigue factor)
G-Force: 0.87 (passenger feels sudden stop)
Description: 0.87G hard braking on local streets at late shift—watch spacing
Coaching: "Strong braking in city. Improve following distance or trip planning."
Manager Question: "OK—this makes sense. Driver was on local streets and braked hard. We should coach on spacing."
```

---

## Summary: Real Data Wins

| Aspect | Seed (Now) | Real Samsara | Manager Impact |
|--------|-----------|-------------|----------------|
| **Severity Calculation** | Index-based arbitrary | G-force physics (0.87G) | Objective, defensible |
| **Location** | Hardcoded generic | Real GPS + reverse geocoding | Accountability |
| **Speed** | Random | Real vehicle telemetry | Context-accurate |
| **Time Context** | Not shown | Timestamp + shift phase | Fatigue consideration |
| **Coaching** | Generic | Data-driven by context | Actionable coaching |
| **Manager Trust** | "Why is this marked high?" | "Physics + context = HIGH" | Builds confidence |

---

## Next Steps

1. ✅ Confirm Samsara API key has "Safety Events" + "Scores" scopes
2. ✅ Implement `fetchSamsaraSafetyEvents()` function
3. ✅ Modify seed-demo-data.ts to call Samsara endpoint
4. ✅ Update EventDetail interface with gforce_magnitude
5. ✅ Update IncidentHeatmap display to show G-force
6. ✅ Test with real data from Samsara account
7. ✅ Compare seed vs real—verify manager experience improves

---

## Decision Questions for User

1. **Which endpoint to start with?**
   - Recommended: `/safety-events` (batch) — simpler, better for daily analytics
   - Alternative: `/safety-events/stream` (WebSocket) — if real-time alerts needed later

2. **Should we include Samsara's severity score (0-10) or use our G-force thresholds?**
   - Recommended: Use G-force thresholds (consistent with speeding logic)
   - Alternative: Use Samsara score as additional field for reference

3. **Fallback strategy if Samsara API is down?**
   - Keep seed data as fallback, or
   - Show "data unavailable" error?

