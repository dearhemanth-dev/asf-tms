/**
 * Incident Heatmap Utilities
 *
 * Transforms raw event data into weekly aggregated structure for heatmap visualization
 * and provides event detail formatting for modal display
 */

export interface EventDetail {
  id: string;
  event_timestamp: string; // ISO format
  event_type: string;
  event_date: string; // YYYY-MM-DD
  truck_unit_number: string;
  latitude: number | null;
  longitude: number | null;
  details: {
    severity?: string;
    location?: string;
    speed?: number;
    posted_limit?: number;
    description?: string;
    duration_minutes?: number;
    duration_seconds?: number; // G-force events: braking/accel duration
    total_idling_minutes?: number;
    idle_percentage?: number;
    engine_hours?: number;
    gforce_magnitude?: number; // Harsh braking/accel: actual G-force value
    samsara_severity_score?: number; // Samsara's calculated severity (0-10)
    [key: string]: unknown;
  };
  metric_value: number;
  event_count: number;
  duration_minutes: number | null;
  data_source: string;
  source_id: string;
  status: string;
}

export interface WeeklyHeatmapData {
  weekStart: string; // YYYY-MM-DD (Monday of week)
  weekEnd: string;   // YYYY-MM-DD (Sunday of week)
  weekLabel: string; // "Jul 1-7" or similar
  incidents: Record<string, number>; // event_type -> count
}

export interface HeatmapCell {
  weekLabel: string;
  weekStart: string;
  incidentType: string;
  count: number;
  intensity: number; // 0-100 for color intensity
  events: EventDetail[]; // Events for this cell
}

/**
 * Get ISO week number and start date from a date string
 */
function getWeekInfo(dateStr: string): { weekStart: string; weekNum: number; year: number } {
  const date = new Date(dateStr + "T00:00:00Z");
  
  // Find Monday of this week
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday
  const diff = date.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(date.setUTCDate(diff));
  
  const weekStart = monday.toISOString().split("T")[0];
  
  // Calculate week number
  const firstDay = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const daysDiff = Math.floor((monday.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000));
  const weekNum = Math.floor(daysDiff / 7) + 1;
  
  return {
    weekStart,
    weekNum,
    year: monday.getUTCFullYear(),
  };
}

/**
 * Format date string as "MMM D" (e.g., "Jul 1")
 */
function formatMonthDay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  return `${month} ${day}`;
}

/**
 * Transform raw events into weekly heatmap structure
 */
export function createWeeklyHeatmap(
  rawEvents: EventDetail[],
  windowDays: number
): HeatmapCell[] {
  // Group events by week and incident type
  const weekMap: Record<
    string,
    Record<string, EventDetail[]>
  > = {};
  
  rawEvents.forEach((event) => {
    const { weekStart } = getWeekInfo(event.event_date);
    if (!weekMap[weekStart]) {
      weekMap[weekStart] = {};
    }
    const typeKey = event.event_type;
    if (!weekMap[weekStart][typeKey]) {
      weekMap[weekStart][typeKey] = [];
    }
    weekMap[weekStart][typeKey].push(event);
  });

  // Flatten into heatmap cells
  const cells: HeatmapCell[] = [];
  const allTypes = new Set<string>();
  
  // Collect all event types
  Object.values(weekMap).forEach((week) => {
    Object.keys(week).forEach((type) => {
      allTypes.add(type);
    });
  });
  
  // Calculate max count for intensity scaling
  let maxCount = 1;
  Object.values(weekMap).forEach((week) => {
    Object.values(week).forEach((events) => {
      maxCount = Math.max(maxCount, events.length);
    });
  });

  // Build cells in reverse chronological order
  Object.entries(weekMap)
    .sort(([weekA], [weekB]) => weekB.localeCompare(weekA))
    .forEach(([weekStart, typeMap]) => {
      const weekEnd = new Date(new Date(weekStart + "T00:00:00Z").getTime() + 6 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      
      const weekLabel = `${formatMonthDay(weekStart)}-${formatMonthDay(weekEnd)}`;

      Array.from(allTypes)
        .sort()
        .forEach((incidentType) => {
          const events = typeMap[incidentType] || [];
          const count = events.length;
          const intensity = count > 0 ? Math.min(100, (count / maxCount) * 100) : 0;

          cells.push({
            weekLabel,
            weekStart,
            incidentType,
            count,
            intensity,
            events,
          });
        });
    });

  return cells;
}

/**
 * Format event timestamp for display (e.g., "2:32 PM")
 */
export function formatEventTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format event date for display (e.g., "Jul 6, 2026")
 */
export function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Get category for event type (for unified heatmap grouping)
 */
export function getEventCategory(eventType: string): { key: string; label: string; color: string } {
  const typeLower = eventType.toLowerCase();
  
  if (typeLower.includes("brake") || typeLower.includes("accel") || typeLower.includes("corner") || typeLower.includes("speeding")) {
    return { key: "safety", label: "Safety", color: "rose" };
  }
  if (typeLower.includes("idle")) {
    return { key: "efficiency", label: "Efficiency", color: "amber" };
  }
  if (typeLower.includes("fuel")) {
    return { key: "fuel", label: "Fuel Performance", color: "cyan" };
  }
  if (typeLower.includes("fault") || typeLower.includes("dvir") || typeLower.includes("maintenance") || 
      typeLower.includes("temp") || typeLower.includes("oil") || typeLower.includes("rpm") || typeLower.includes("load")) {
    return { key: "maintenance", label: "Maintenance & Compliance", color: "violet" };
  }
  return { key: "other", label: "Other", color: "slate" };
}

/**
 * Normalize event type name for display (e.g., "harsh_brake_incident" -> "Harsh Brake")
 */
export function normalizeEventTypeName(eventType: string): string {
  return eventType
    .replace(/_incident$/, "")
    .replace(/_episode$/, "")
    .replace(/_event$/, "")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get color class for incident type
 */
export function getIncidentTypeColor(eventType: string): string {
  const category = getEventCategory(eventType);
  return category.color;
}

/**
 * Get intensity-based background color for heatmap cell
 */
export function getHeatmapCellClass(intensity: number, baseColor: string): string {
  if (intensity === 0) {
    return "bg-slate-800/20 border-slate-700/30";
  }
  if (intensity <= 25) {
    return `bg-${baseColor}-950/40 border-${baseColor}-700/20`;
  }
  if (intensity <= 50) {
    return `bg-${baseColor}-950/60 border-${baseColor}-700/40`;
  }
  if (intensity <= 75) {
    return `bg-${baseColor}-950/80 border-${baseColor}-700/60`;
  }
  return `bg-${baseColor}-900 border-${baseColor}-600`;
}
