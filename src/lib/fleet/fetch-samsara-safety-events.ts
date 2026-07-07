/**
 * Fetch Samsara Safety Events
 * Queries GET /safety-events endpoint for harsh braking, acceleration, and cornering events
 * Used for real driver safety data instead of seed data
 */

export interface SamsaraSafetyEvent {
  id: string;
  eventType: "harshBraking" | "harshAcceleration" | "harshCornering";
  occurredAt: string;
  vehicle: {
    id: string;
    name: string;
  };
  driver: {
    id: string;
    name: string;
  };
  gForceMagnitude: number;
  speedMph: number;
  location: {
    latitude: number;
    longitude: number;
  };
  durationSeconds: number;
  scores?: {
    severity?: number;
    coachingOpportunity?: number;
  };
}

export interface SamsaraSafetyEventsResponse {
  data: SamsaraSafetyEvent[];
  pagination?: {
    hasNextPage: boolean;
    endCursor?: string;
  };
}

/**
 * Fetch safety events from Samsara API
 * @param token Samsara API bearer token
 * @param options Query filters: date range, vehicle IDs, driver IDs
 * @returns Array of safety events
 */
export async function fetchSamsaraSafetyEvents(
  token: string,
  options: {
    startTime: string;
    endTime: string;
    vehicleIds?: string[];
    driverIds?: string[];
    limit?: number;
  }
): Promise<SamsaraSafetyEvent[]> {
  if (!token) {
    console.warn("[samsara-safety-events] No API token provided");
    return [];
  }

  try {
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

    const url = `https://api.samsara.com/safety-events?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `[samsara-api] Safety events request failed (status ${response.status}): ${errorText.substring(0, 150)}`
      );
      return [];
    }

    const data = (await response.json()) as SamsaraSafetyEventsResponse;
    return data.data ?? [];
  } catch (error) {
    console.warn("[samsara-api] Failed to fetch safety events", error instanceof Error ? error.message : String(error));
    return [];
  }
}

/**
 * Calculate severity from G-force (physics-based, not arbitrary)
 * @param gForceMagnitude G-force value
 * @returns "high" | "moderate" | "low"
 */
export function calculateSeverityFromGForce(
  gForceMagnitude: number
): "high" | "moderate" | "low" {
  if (gForceMagnitude >= 0.85) return "high";
  if (gForceMagnitude >= 0.65) return "moderate";
  return "low";
}

/**
 * Generate manager-friendly description from Samsara safety event
 * @param event Samsara event
 * @param roadType Road context (e.g., "Interstate", "Highway 55", "Local streets")
 * @param reverseGeocodedLocation City/neighborhood (e.g., "Portland, OR")
 * @returns Manager-friendly description
 */
export function generateEventDescription(
  event: SamsaraSafetyEvent,
  roadType: string,
  reverseGeocodedLocation: string
): string {
  const gForce = event.gForceMagnitude.toFixed(2);
  const eventTypeLabel =
    event.eventType === "harshBraking"
      ? "hard braking"
      : event.eventType === "harshAcceleration"
        ? "acceleration"
        : "cornering";

  const date = new Date(event.occurredAt);
  const hour = date.getHours();
  const shiftContext =
    hour < 6 ? "early shift" : hour < 18 ? "mid-day" : "late shift";

  // Coaching tip based on event type and context
  let coachingTip = "improve control";
  if (event.eventType === "harshBraking") {
    coachingTip = "watch spacing—improve planning";
  } else if (event.eventType === "harshAcceleration") {
    coachingTip = "smooth acceleration—smooth starts";
  }

  return `${gForce}G ${eventTypeLabel} on ${roadType} at ${shiftContext}—${coachingTip}`;
}
