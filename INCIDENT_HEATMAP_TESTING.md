# Incident Heatmap Implementation - Testing Guide

## Feature Overview

Replaced the old 7-day incident history bullet-point summary with a sophisticated **3-level drill-down UX**:

1. **Level 1**: Category Cards (Safety, Efficiency, Fuel, Compliance) showing metric summaries
2. **Level 2**: Weekly Incident Heatmap (incident type × week matrix with color intensity encoding)
3. **Level 3**: Event Detail Modal (exact timestamps, locations, severity, speed, description)

## Files Changed

- `src/lib/analytics/incident-heatmap.ts` (new) - 210 lines
  - Heatmap data transformation utilities
  - Type definitions for `HeatmapCell`, `EventDetail`, `WeeklyHeatmapData`
  - Color mapping functions
  
- `src/components/IncidentHeatmap.tsx` (new) - ~300 lines
  - React component rendering matrix grid + event modal
  - Pre-computed Tailwind classes for all color/intensity combinations
  - Modal with sticky header and scrollable event list

- `src/app/reports/driver-ranking/page.tsx` (modified) - key changes
  - Added imports for heatmap component and utilities
  - Updated `expandedDriverEvents` type to include `raw_events: EventDetail[]`
  - Replaced incident history section (lines 798-830) with heatmap component

## How to Test

### Local Testing (Development)

```bash
cd c:\Dev\asf-tms

# Start dev server
npm run dev

# Navigate to http://localhost:3000/reports/driver-ranking
# Use session storage to set auth:
#   sessionStorage.setItem("demoRole", "management")
#   sessionStorage.setItem("demoUsername", "hkmanager")
```

### Production Testing

```bash
# Deploy to Vercel
vercel --prod --yes

# Test on https://asf-tms.vercel.app/reports/driver-ranking
# Note: Requires authenticated session (login or existing session cookie)
```

## Test Scenarios

### Scenario 1: Heatmap Visibility
**Steps:**
1. Navigate to Driver Ranking page
2. Expand any driver card (click on it)
3. Scroll down to "Incident History" section

**Expected Result:**
- Old format (7-day bullet list) is replaced with a new matrix grid
- Grid shows "Incident Type" column header (left side)
- Week labels appear as column headers (e.g., "Jul 1-7", "Jul 8-14")
- Grid cells contain numbers (incident counts) or "—" (no data)

### Scenario 2: Color Intensity Coding
**Steps:**
1. In heatmap, observe cell backgrounds

**Expected Result:**
- Incident types color-coded by category:
  - **Rose**: Harsh Brake, Harsh Accel, Harsh Corner (Safety)
  - **Amber**: Idle Time (Efficiency)
  - **Cyan**: Fuel Events (Fuel)
  - **Violet**: Fault Codes, Maintenance, DVIR (Compliance)
- Color intensity increases with count:
  - Light (25%+): `{color}-950/40` background
  - Medium (50%+): `{color}-950/60` background
  - Dark (75%+): `{color}-950/80` background
  - Darkest (100%): `{color}-900` background

### Scenario 3: Event Modal
**Steps:**
1. In heatmap, click a cell with a count > 0
2. Modal should appear

**Expected Result:**
- Modal appears as bottom-sheet (mobile) or centered box (desktop)
- **Header**: Incident type name + week label (e.g., "Harsh Brake" + "Jul 1-7") with Close button
- **Body**: Scrollable list of events with:
  - Event timestamp (e.g., "2:32 PM")
  - Event date (e.g., "Jul 6, 2026")
  - Severity badge (high=rose, moderate=amber, low=slate)
  - Location (from `details.location`)
  - Speed in mph (from `details.speed`)
  - Description (from `details.description`)
  - Truck unit number

### Scenario 4: Mobile Responsiveness
**Steps:**
1. Open browser DevTools and enable mobile view (375px width)
2. Navigate to driver ranking page
3. Expand driver
4. Scroll to heatmap
5. Click a heatmap cell

**Expected Result:**
- Heatmap grid scrolls horizontally if needed
- Modal appears as full-width bottom-sheet
- Modal header is sticky (always visible when scrolling events)
- Close button is accessible at the top
- Events list is scrollable within modal bounds

### Scenario 5: Empty Cells
**Steps:**
1. In heatmap, find cells with "—" symbol
2. Try to click them

**Expected Result:**
- Empty cells have light gray background (`bg-slate-800/20`)
- Clicking empty cells does nothing (button is disabled)

## API Contract

The endpoint `/api/analytics/driver-events` must return:

```typescript
{
  driver_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  total_events: number;
  events_by_date: Record<string, Record<string, unknown[]>>;
  raw_events: Array<{
    id: string;
    event_timestamp: string; // ISO 8601 (TIMESTAMPTZ)
    event_type: string;
    event_date: string; // YYYY-MM-DD
    truck_unit_number: string;
    details: {
      location?: string;      // CRITICAL for modal display
      severity?: string;      // "high" | "moderate" | "low"
      speed?: number;         // mph value
      description?: string;   // event description
      [key: string]: unknown;
    };
    metric_value: number;
    event_count: number;
    duration_minutes: number | null;
    data_source: string;
    source_id: string;
    status: string;
  }>;
  query_time_ms: number;
}
```

## Known Limitations

1. **Auth Required**: Browser must have management role session set
2. **No Empty Week Hiding**: All weeks show even if no events (could be optimized)
3. **No Export**: Events can't be exported from modal (enhancement for later)
4. **No Filtering**: Can't filter heatmap by incident type or week range

## Performance Characteristics

- **Heatmap Rendering**: O(T × W) where T = incident types, W = weeks
  - For 30 days: ~7-8 incident types × 4-5 weeks = 28-40 cells
  - For 60 days: ~7-8 incident types × 8-9 weeks = 56-72 cells
- **Modal Rendering**: O(E) where E = events in selected cell
  - Typical: 5-15 events per cell
  - Max tested: 100+ events (scrolls smoothly)

## Deployment History

- **Commit**: `9916c13` - feat: implement weekly incident heatmap with event detail drill-down
- **Deployed**: https://asf-tms.vercel.app (aliased to vercel production)
- **Direct URL**: https://asf-edxdpv8uy-hemanth-tms-projects.vercel.app

## Next Steps

1. **Immediate**: Manual test on production with authenticated session
2. **Short-term**: Optimize empty week display for 60-day view
3. **Future**: Add CSV export, advanced filtering, pattern recognition visualization
