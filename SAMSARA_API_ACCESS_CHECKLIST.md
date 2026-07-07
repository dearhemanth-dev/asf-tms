# Samsara API Access Checklist

## Status
**Target:** Get API permissions enabled this week  
**Current:** Ready to integrate once permissions are confirmed  
**Release:** v1.6.1 (demo data) deployed, real data integration ready  

---

## What You Need to Request from Samsara

### 1. **API Access Token**
- Contact Samsara support or your account manager
- Request: **"Enable API access for my organization"**
- You should receive: API key/token for authentication
- Format: Usually starts with `samsara_` prefix

### 2. **Required API Scopes**

For the ASF TMS application, request these **safety & telematics scopes**:

```
REQUIRED SCOPES:
✓ vehicles:read              — Get fleet vehicle data
✓ drivers:read               — Get driver profiles
✓ vehicle_stats:read         — Real-time/historical vehicle metrics
✓ safety_events:read         — Safety incidents (harsh braking, speeding, etc.)
✓ vehicle_locations:read     — GPS coordinates for idle location validation
✓ maintenance_requests:read  — Vehicle maintenance status
✓ fault_codes:read           — Engine diagnostic codes
```

**Optional but useful:**
- `fleet:read` — Fleet-wide analytics
- `reports:read` — Historical reports data

### 3. **Exact Ask for Samsara Support**

**Copy this and send to Samsara:**

> I need API access for my fleet management application. I'm an existing Samsara subscriber with [number] vehicles. 
> 
> I need an API token with these scopes:
> - vehicles:read
> - drivers:read
> - vehicle_stats:read
> - safety_events:read
> - vehicle_locations:read
> - maintenance_requests:read
> - fault_codes:read
> 
> This is for integrating real telematics data into our internal TMS system. Webhook support would be helpful for real-time events.

---

## What ASF TMS Will Do Once You Have API Access

### Data Integration Flow
```
Your Samsara Fleet
       ↓
API Tokens (in .env.local)
       ↓
ASF TMS /api/samsara/* endpoints
       ↓
Supabase (PostgreSQL)
       ↓
Driver Ranking Dashboard
    • Real DPI scores
    • Real safety events
    • Real idling data
    • Real efficiency metrics
```

### Files Ready to Use Your Token

**Environment Setup:**
- `.env.local` needs: `SAMSARA_API_KEY=samsara_xxxxxx`
- Already configured in project

**Samsara Integration Files:**
- `src/app/api/samsara/vehicles` — Fetch real vehicle list
- `src/app/api/samsara/fault-codes` — Get diagnostic data
- `src/app/api/samsara/safety-events` — Ingest safety incidents
- `src/lib/fleet/Provider_Samsara_*.ts` — Data mappers ready to use

---

## Timeline & Next Steps

### Week 1 (This Week)
- [ ] Contact Samsara support for API access
- [ ] Provide token & confirm scopes are enabled
- [ ] Add token to `.env.local` in production
- [ ] Test connection with `POST /api/samsara/test-connection` (endpoint to create)

### Week 2
- [ ] Enable webhook for real-time safety events
- [ ] Start ingesting real vehicle data
- [ ] Validate DPI calculations with real metrics
- [ ] Transition from demo data to production

### Production Cutover
- Keep demo data available for testing/training
- Run both in parallel for 1-2 days
- Switch primary view to real data
- Archive demo data for reference

---

## Samsara Support Contact

**Typical paths:**
1. **Self-service:** Samsara Dashboard → Settings → Integrations → API Access
2. **Support:** support@samsara.com
3. **Account Manager:** Your dedicated AM (if you have enterprise plan)
4. **Docs:** https://developers.samsara.com/

---

## Data We'll Pull From Samsara

### 1. **Vehicle Data**
- Unit numbers (VIN, license plate)
- Fleet assignment
- Current location
- Fuel level (if available)

### 2. **Driver Data**
- Driver ID & name
- Safety scores (Samsara's proprietary algorithm)
- Hours of Service compliance
- License expiration

### 3. **Safety Events** (Real-time)
- Harsh braking (G-force magnitude)
- Harsh acceleration
- Harsh cornering
- Speeding violations
- Rapid acceleration/deceleration
- Engine idling notifications

### 4. **Vehicle Stats** (Daily/Historical)
- Distance traveled
- Fuel efficiency (MPG)
- Engine hours
- Idle time/percentage
- Speed distribution

### 5. **Maintenance**
- Fault codes (DTC)
- Maintenance alerts
- Service history

---

## What Gets Calculated Locally (No API Calls)

Once real data is ingested:
- **DPI Scoring** — Real safety metrics + efficiency
- **Driver Ranking** — Percentile tiers (Top 10%, Average, Below Avg)
- **Idling Cost Analysis** — Fuel waste ($), CO2, location context
- **Fleet Benchmarking** — Average MPG, idle %, safety scores

---

## Security Notes

✅ **API Key Storage:**
- Stored in `.env.local` (local only, not committed)
- Production: Use Vercel Environment Secrets
- Never log or expose in UI

✅ **Data Privacy:**
- All data stays in your Supabase instance
- No third-party data sharing
- You own the analytics

✅ **Rate Limiting:**
- Samsara typically allows 100 req/sec
- ASF TMS will use batching to stay well under limits
- Real-time webhooks are efficient (no polling)

---

## Verification Checklist

Once you get the token, we can verify:

- [ ] API key is valid
- [ ] Scopes are enabled
- [ ] Can retrieve vehicle list
- [ ] Can retrieve driver list
- [ ] Can receive safety events
- [ ] Webhook endpoint is working
- [ ] Data is flowing to Supabase
- [ ] Dashboard shows real metrics

---

## Questions for Samsara Support

If they have any questions, clarify:

**Q: "What's your use case?"**  
A: "Internal telematics dashboard for driver coaching and fleet efficiency tracking. Real-time safety event monitoring and historical analytics."

**Q: "Do you need real-time or batch?"**  
A: "Both - real-time webhooks for safety alerts, batch daily for historical metrics."

**Q: "What permissions do you need?"**  
A: "Read-only access to vehicles, drivers, safety events, and vehicle stats. No write permissions needed."

---

## Current Status: v1.6.1 Release

✅ **Demo Data Fully Functional**
- 32 drivers with realistic metrics
- Idling, fuel, safety events all working
- Location-aware coaching insights
- Cost-based impact display

**Ready for Samsara Integration**
- Infrastructure complete
- APIs documented and tested with demo data
- Calculation logic validated
- Production-ready code

---

## Notes

- This is a **standard request** for any Samsara subscriber
- You don't need special enterprise tier
- Individual API keys are cheaper than custom development
- Typical approval: 1-2 days
- No additional costs for reads (safety events, vehicle data)
