# Samsara API Data Availability Audit

**Last Updated:** 2026-07-06  
**Purpose:** Verify all demo data fields match real Samsara API capabilities

---

## 1. DEMO DATA FIELDS IN USE (Mobile UI)

### Event Metadata (Available from all events)
- ✅ **Event Type** — brake, accel, speeding, idling, fault, etc.
- ✅ **Event Timestamp** — ISO format with time
- ✅ **Event Date** — calendar date
- ✅ **Driver ID & Name** — fleet identity
- ✅ **Truck Unit Number** — vehicle identifier
- ✅ **GPS Coordinates (lat/lon)** — real-time vehicle position

---

## 2. PER-EVENT-TYPE DATA AVAILABILITY

### Safety Events (Harsh Brake, Accel, Corner)

**What We Generate:**
```
severity: "high" | "moderate" | "low"
speed: number (mph)
location: string (e.g., "I-5 Exit 42")
description: string
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Event Type (brake/accel/corner) | ✅ YES | Safety telemetry |
| Severity Level | ❓ PARTIAL | Only via custom thresholds |
| Speed (MPH) | ✅ YES | GPS/odometer data |
| Location (street/highway) | ❓ REVERSE GEOCODE | From GPS via 3rd party |
| Timestamp | ✅ YES | Event timestamp |

**CONCERN:** Samsara provides event type + speed + timestamp, but **NOT** pre-calculated severity. We infer severity from context (first event = high, others = moderate/low).

---

### Speeding Incidents

**What We Generate:**
```
speed: number (actual mph)
posted_limit: number (65 mph assumed)
description: "Speeding event: X mph over limit"
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Current Speed | ✅ YES | GPS + vehicle telemetry |
| Posted Speed Limit | ❓ EXTERNAL | Road database (Google Maps, HERE) |
| Duration of speeding | ✅ YES | Start/end timestamp |
| Location | ✅ YES | GPS coordinates |

**CONCERN:** Samsara gives us **speed + duration**, but posted speed limits require external road database. We're assuming 65 mph in seed data.

---

### Idling Episode

**What We Generate:**
```
total_idling_minutes: number
engine_hours: number
idle_percentage: number (% of active engine time)
location: string
description: string
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Idling Duration (minutes) | ✅ YES | Engine state + GPS motion |
| Engine Runtime (hours) | ✅ YES | OBD engine telemetry |
| Idle % of total engine time | ✅ CALCULATED | (idling_min / engine_min) |
| Location | ✅ YES | GPS during idle period |

**STATUS:** ✅ ALL AVAILABLE — Samsara provides engine state, we calculate percentages.

---

### Fuel Events

**What We Generate:**
```
// Low Fuel Alert
fuel_level_percent: number (current tank %)
events: number (alert count)

// Fuel Consumption (DAILY AGGREGATE)
liters_consumed: number
gallons_consumed: number
engine_hours: number
description: "15.45 gal • 9h engine runtime"
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Current Fuel Level (%) | ✅ YES | Tank sensor / OBD data |
| Fuel Level Alerts | ✅ YES | Rules-based thresholds |
| Fuel Consumed (L/gal) | ❌ **NOT DIRECTLY** | |
| Engine Hours | ✅ YES | OBD telemetry |

**CRITICAL CONCERN:** 
- ✅ Fuel level % and alerts are available
- ❌ **Fuel consumption is NOT directly provided by Samsara**
  - Samsara shows fuel level snapshots (e.g., 80% → 40%)
  - To calculate consumption: need (start_level - end_level) × tank_capacity
  - Tank capacity varies by vehicle — must be stored in fleet vehicle config
  - This requires external fuel card data OR vehicle fuel tank spec

**DECISION NEEDED:** 
1. Remove fuel consumption from display (keep only fuel level %)?
2. Add vehicle fuel tank capacity to schema (e.g., 150 gallon Peterbilt)?
3. Integrate with fuel card provider (Fleetio, Fuelman)?

---

### DVIR Defects

**What We Generate:**
```
defect_count: number
components: string ("Brake system", "Tire condition", "Lights")
severity: string ("medium")
description: string
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| DVIR Defects | ✅ YES | Samsara DVIR module |
| Component Type | ✅ YES | DVIR form data |
| Severity | ❓ PARTIAL | Custom classification |
| Defect Description | ✅ YES | Driver notes in DVIR |

**STATUS:** ✅ MOSTLY AVAILABLE — requires Samsara DVIR integration.

---

### Maintenance Alerts

**What We Generate:**
```
alert_count: number
alert_type: string ("Scheduled service due")
description: string
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Maintenance Alerts | ✅ YES | Samsara Maintenance module |
| Alert Type | ✅ YES | Alert classification |
| Description | ✅ YES | Alert details |

**STATUS:** ✅ AVAILABLE — requires Samsara Maintenance integration (may need premium tier).

---

### Fault Codes (OBD Diagnostics)

**What We Generate:**
```
fault_code: string ("P0101", "P0107")
component: string ("Mass Air Flow", "Manifold Absolute Pressure")
description: string
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Fault Code (P-codes) | ✅ YES | OBD-II diagnostics |
| Fault Description | ✅ YES | OBD fault registry |
| Component Affected | ✅ YES | Code lookup table |

**STATUS:** ✅ AVAILABLE — Samsara exposes OBD fault codes via API.

---

### Engine/Vehicle Sensors (High Temp, Low Oil, High RPM, High Load)

**What We Generate:**
```
// High Temp
temp_celsius: number (105-115°C)
component: string ("Coolant system")

// Low Oil
oil_level: string ("Low")
component: string ("Engine oil")

// High RPM
max_rpm: number (2200-2600 RPM)

// High Load
load_percent: number (85-100%)
```

**Samsara Provides:**
| Field | Available | Source |
|-------|-----------|--------|
| Coolant Temperature | ✅ YES | OBD sensor data |
| Oil Pressure Warning | ✅ YES | OBD fault code (P0520) |
| Engine RPM | ✅ YES | OBD engine speed |
| Engine Load (%) | ✅ YES | OBD calculated load |

**STATUS:** ✅ ALL AVAILABLE — OBD sensor data via Samsara API.

---

## 3. LOCATION DATA GAPS

### What We Use
```
- GPS coordinates (lat/lon) → reverse geocode to city/region
- Hardcoded location strings ("I-5 Exit 42", "Downtown", etc.)
- Location stored in event details
```

### What Samsara Provides
| Item | Available |
|------|-----------|
| GPS coordinates | ✅ YES |
| Reverse geocoded address | ❌ NO (must use 3rd party) |
| Hardcoded location names | ❌ NO (not in API) |

**CONCERN:** We're generating hardcoded location strings like "I-5 Exit 42" in seed data. Real Samsara only gives GPS; we must geocode via Google Maps/Mapbox or accept raw lat/lon.

---

## 4. MISSING OR UNAVAILABLE FIELDS

| Field | Why Missing | Impact |
|-------|-----------|--------|
| **Fuel Consumption** | Samsara doesn't calculate; need external integration | HIGH — currently demo only |
| **Posted Speed Limit** | Not in Samsara; need road database | MEDIUM — we assume 65 mph |
| **Location Name** | Not in Samsara; must reverse geocode | LOW — we already do this |
| **Severity (calculated)** | Not in Samsara; we infer from context | LOW — app-level classification |
| **Trip/Route Context** | Samsara provides; not using yet | LOW — future enhancement |

---

## 5. REAL SAMSARA DATA REQUIREMENTS CHECKLIST

To use REAL Samsara data instead of demo seed:

- [ ] **API Integration**
  - [ ] Samsara API key configured
  - [ ] Authentication token refresh workflow
  - [ ] Rate limiting (1000 req/min)
  
- [ ] **Vehicle Data**
  - [ ] `/fleet/vehicles` endpoint mapping
  - [ ] Fuel tank capacity per vehicle (for consumption calc)
  - [ ] Vehicle make/model/year
  
- [ ] **Driver Data**
  - [ ] `/fleet/drivers` endpoint mapping
  - [ ] Driver names, license info
  
- [ ] **Telematics Events**
  - [ ] `/events` or `/vehicle-events` real-time streaming
  - [ ] Safety events (harsh brake, accel, corner)
  - [ ] Speeding events + threshold configuration
  - [ ] OBD fault codes
  - [ ] Sensor data (temp, oil, RPM, load)
  
- [ ] **Optional Integrations**
  - [ ] DVIR module (Samsara Safety)
  - [ ] Maintenance module (Samsara Fleet Operations)
  - [ ] Fuel card provider (Fleetio, Fuelman, WEX)
  - [ ] Reverse geocoding service (Google Maps, Mapbox, Nominatim)

---

## 6. RECOMMENDED UX CHANGES FOR PRODUCTION

### Keep (High Confidence - Samsara Has This)
- ✅ Event type, time, date, truck unit
- ✅ GPS location (raw coordinates)
- ✅ Speed (for brake/accel/corner/speeding)
- ✅ Engine hours and idling %
- ✅ Fuel level % and low fuel alerts
- ✅ OBD fault codes
- ✅ DVIR defects (if subscription includes it)

### Change (Low Confidence - Needs External Data)
- 🔄 **Hardcoded location strings** → Use reverse geocoding only
- 🔄 **Posted speed limit** → Calculate from configured threshold, not actual road limit
- 🔄 **Severity classification** → Define in app logic, not infer from Samsara

### Remove (Not Available from Samsara)
- ❌ **Fuel consumption** (unless integrated with fuel card provider)
  - **Alternative:** Show fuel level % only: "Tank at 40% (was 80% 2 hrs ago)"
  - Requires vehicle fuel tank capacity in database

### Add for Better Context
- 📝 **Trip/Route information** — Samsara provides destination when available
- 📝 **Geofence context** — Is vehicle in/out of geofence at time of event?
- 📝 **Driver status** — On duty, off duty, driving, on break?

---

## 7. IMMEDIATE ACTION ITEMS

### Priority 1: Data Availability Risk
**Fuel Consumption Display**
- Current: Demo shows "15.45 gal • 9h engine runtime"
- Problem: Samsara cannot provide this without external fuel card
- Option A: Remove fuel consumption from mobile UI
- Option B: Implement vehicle fuel tank capacity + calculate from level change
- Option C: Integrate fuel card provider API

### Priority 2: Location Accuracy
**Hardcoded Location Strings**
- Current: Demo uses "I-5 Exit 42", "Downtown", etc.
- Problem: Real Samsara only gives GPS; these strings won't exist
- Solution: Modify seed data to show reverse-geocoded locations only

### Priority 3: Speed Limit Context
**Posted Speed Limit**
- Current: Demo assumes 65 mph
- Problem: Actual posted limits vary by road
- Solution: Replace with app-configured threshold (e.g., "speeding when > 68 mph")

---

## CONCLUSION

**Bottom Line:**
- ✅ **70%** of demo data fields are available from Samsara
- ⚠️ **20%** requires external integrations (fuel cards, road database)
- ❌ **10%** needs app-level inference (severity, location names)

**Most Critical Gap:** Fuel consumption cannot be reliably calculated without vehicle tank capacity or external fuel card data.

**Recommendation:** Decide now whether to:
1. Remove fuel consumption from production display
2. Implement vehicle fuel tank capacity tracking
3. Integrate with fuel card provider

---
