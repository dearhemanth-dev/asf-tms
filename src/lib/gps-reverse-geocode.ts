/**
 * GPS Reverse Geocoding
 * Converts coordinates to readable location names with context
 */

interface Waypoint {
  name: string;
  lat: number;
  lon: number;
  region: string;
}

const ROUTE_WAYPOINTS: Waypoint[] = [
  // I-5 Corridor (West Coast)
  { name: "Los Angeles, CA", lat: 34.0522, lon: -118.2437, region: "I-5-CA" },
  { name: "Bakersfield, CA", lat: 35.3733, lon: -119.0187, region: "I-5-CA" },
  { name: "Fresno, CA", lat: 36.7469, lon: -119.7726, region: "I-5-CA" },
  { name: "Stockton, CA", lat: 37.9577, lon: -121.2911, region: "I-5-CA" },
  { name: "Sacramento, CA", lat: 38.5816, lon: -121.4944, region: "I-5-CA" },
  { name: "Red Bluff, CA", lat: 40.1737, lon: -121.2353, region: "I-5-CA" },
  { name: "Salem, OR", lat: 44.9429, lon: -123.3351, region: "I-5-OR" },
  { name: "Portland, OR", lat: 45.5152, lon: -122.6784, region: "I-5-OR" },
  { name: "Seattle, WA", lat: 47.6062, lon: -122.3321, region: "I-5-WA" },
  { name: "Bellingham, WA", lat: 48.7519, lon: -122.4787, region: "I-5-WA" },
  { name: "Vancouver, BC", lat: 49.2827, lon: -123.1207, region: "I-5-BC" },
  
  // I-80 Corridor (Cross-country)
  { name: "San Francisco Bay, CA", lat: 37.5483, lon: -121.9886, region: "I-80-CA" },
  { name: "Reno, NV", lat: 39.5296, lon: -119.8138, region: "I-80-NV" },
  { name: "Salt Lake City, UT", lat: 40.7608, lon: -111.8910, region: "I-80-UT" },
  { name: "Cheyenne, WY", lat: 41.1400, lon: -104.8202, region: "I-80-WY" },
  { name: "Omaha, NE", lat: 41.2565, lon: -95.9345, region: "I-80-NE" },
  { name: "Des Moines, IA", lat: 41.5868, lon: -93.6250, region: "I-80-IA" },
  { name: "Chicago, IL", lat: 41.8781, lon: -87.6298, region: "I-80-IL" },
  
  // I-40 Corridor (Southern route)
  { name: "Barstow, CA", lat: 34.8926, lon: -117.0235, region: "I-40-CA" },
  { name: "Flagstaff, AZ", lat: 35.1945, lon: -111.6553, region: "I-40-AZ" },
  { name: "Albuquerque, NM", lat: 35.0844, lon: -106.6504, region: "I-40-NM" },
  { name: "Amarillo, TX", lat: 35.3733, lon: -101.5337, region: "I-40-TX" },
  { name: "Oklahoma City, OK", lat: 35.4676, lon: -97.5164, region: "I-40-OK" },
  { name: "Memphis, TN", lat: 35.1264, lon: -90.0043, region: "I-40-TN" },
  { name: "Asheville, NC", lat: 35.5951, lon: -82.5515, region: "I-40-NC" },
  
  // I-10 Corridor (Southern)
  { name: "Phoenix, AZ", lat: 33.4484, lon: -112.0742, region: "I-10-AZ" },
  { name: "Tucson, AZ", lat: 32.2226, lon: -110.9747, region: "I-10-AZ" },
  { name: "El Paso, TX", lat: 31.7619, lon: -106.4850, region: "I-10-TX" },
  { name: "San Antonio, TX", lat: 29.4241, lon: -98.4936, region: "I-10-TX" },
  { name: "Houston, TX", lat: 29.7604, lon: -95.3698, region: "I-10-TX" },
  { name: "Lafayette, LA", lat: 30.2345, lon: -92.0198, region: "I-10-LA" },
  { name: "New Orleans, LA", lat: 29.9511, lon: -90.2623, region: "I-10-LA" },
  { name: "Mobile, AL", lat: 30.6954, lon: -88.0399, region: "I-10-AL" },
  { name: "Jacksonville, FL", lat: 30.3322, lon: -81.6557, region: "I-10-FL" },
  
  // CA-99 (Central Valley)
  { name: "Visalia, CA", lat: 36.1699, lon: -119.2881, region: "CA-99" },
  
  // US-101 (Pacific Coast)
  { name: "San Diego, CA", lat: 32.7157, lon: -117.1611, region: "US-101-CA" },
  { name: "San Francisco, CA", lat: 37.7749, lon: -122.4194, region: "US-101-CA" },
  
  // Mexico
  { name: "Tijuana, Mexico", lat: 32.5149, lon: -117.0382, region: "MEX-BORDER" },
  { name: "Mexicali, Mexico", lat: 32.6392, lon: -115.4526, region: "MEX-BORDER" },
  { name: "Hermosillo, Mexico", lat: 29.0729, lon: -110.9559, region: "MEX-SONORA" },
  { name: "Ciudad Juárez, Mexico", lat: 31.7356, lon: -106.4888, region: "MEX-BORDER" },
  { name: "Nuevo Laredo, Mexico", lat: 27.4369, lon: -99.5305, region: "MEX-BORDER" },
  { name: "Monterrey, Mexico", lat: 25.6866, lon: -100.3161, region: "MEX-NORTE" },
  
  // Canada
  { name: "Calgary, AB", lat: 51.0447, lon: -114.0719, region: "CAN-AB" },
  { name: "Edmonton, AB", lat: 53.5461, lon: -113.4938, region: "CAN-AB" },
  { name: "Toronto, ON", lat: 43.6532, lon: -79.3832, region: "CAN-ON" },
  
  // Major hubs
  { name: "Denver, CO", lat: 39.7392, lon: -104.9903, region: "HUB" },
  { name: "Kansas City, MO", lat: 39.0997, lon: -94.5786, region: "HUB" },
  { name: "Dallas, TX", lat: 32.7767, lon: -96.7970, region: "HUB" },
  { name: "Atlanta, GA", lat: 33.7490, lon: -84.3880, region: "HUB" },
];

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get context/amenities for a location based on region
 */
function getLocationContext(region: string, distance: number): string {
  // If very close to waypoint, include specific context
  if (distance < 5) {
    if (region.includes("HUB")) return "Major freight hub • Truck stops nearby";
    if (region.includes("MEX")) return "Border crossing area • Customs facilities";
    if (region.includes("CAN")) return "Canadian border region • Rest areas available";
    if (region.includes("I-5") || region.includes("I-80") || region.includes("I-40") || region.includes("I-10")) {
      return "Major interstate • Truck stops & rest areas nearby";
    }
  }
  
  // For coordinates further from waypoint (on the road between points)
  if (distance < 20) return "En route • Truck amenities ahead";
  return "Remote area • Plan refueling";
}

export interface ResolvedLocation {
  city_region: string;
  context: string;
  distance_to_hub: number;
  original_location?: string;
}

/**
 * Reverse geocode GPS coordinates to readable location
 * @param latitude GPS latitude
 * @param longitude GPS longitude
 * @param originalLocation Optional: original location string from event
 * @returns Resolved location with city, region, and context
 */
export function reverseGeocodeCoordinates(
  latitude: number | null,
  longitude: number | null,
  originalLocation?: string
): ResolvedLocation | null {
  if (!latitude || !longitude) return null;

  // Find nearest waypoint
  let nearest = ROUTE_WAYPOINTS[0];
  let minDistance = calculateDistance(latitude, longitude, nearest.lat, nearest.lon);

  for (const waypoint of ROUTE_WAYPOINTS) {
    const distance = calculateDistance(latitude, longitude, waypoint.lat, waypoint.lon);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = waypoint;
    }
  }

  // Get context based on location
  const context = getLocationContext(nearest.region, minDistance);

  return {
    city_region: nearest.name,
    context,
    distance_to_hub: Math.round(minDistance * 10) / 10, // Round to 1 decimal
    original_location: originalLocation,
  };
}

/**
 * Format resolved location for display
 */
export function formatResolvedLocation(resolved: ResolvedLocation | null): string {
  if (!resolved) return "";
  
  return `${resolved.city_region} • ${resolved.context}`;
}
