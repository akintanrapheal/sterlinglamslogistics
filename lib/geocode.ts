/**
 * Shared address geocoder: Google Maps Geocoding API with an OpenStreetMap
 * (Nominatim) fallback.
 *
 * Why this module exists: a Google *configuration* failure (billing disabled,
 * key restricted, quota exhausted) returns HTTP 200 with `status:
 * "REQUEST_DENIED"` and an empty `results` array. Checking only `res.ok` makes
 * that indistinguishable from a genuine "address not found", so the failure
 * used to fall through to Nominatim and disappear — orders were written with no
 * lat/lng and nothing was logged. This module separates the two cases and
 * records config failures so callers can surface them.
 */

export type LatLng = { lat: number; lng: number }

/** Google statuses that mean "the request was fine, we just found nothing". */
const SOFT_MISS = new Set(["ZERO_RESULTS"])

type GeocodeHealth = {
  /** Last hard (config-level) failure from Google, if any. */
  lastError: { status: string; message: string; at: Date } | null
  /** How many hard failures since process start — logged once, counted always. */
  errorCount: number
}

const health: GeocodeHealth = { lastError: null, errorCount: 0 }

/**
 * Snapshot of geocoder health. Non-null `lastError` means Google geocoding is
 * misconfigured and results are coming from the (much weaker) OSM fallback.
 */
export function getGeocodeHealth(): Readonly<GeocodeHealth> {
  return { lastError: health.lastError, errorCount: health.errorCount }
}

/** Records a hard failure. Logs the first one loudly, then throttles to avoid
 *  emitting one line per address during a bulk backfill. */
function recordHardFailure(status: string, message: string) {
  const first = health.errorCount === 0
  health.errorCount++
  health.lastError = { status, message, at: new Date() }

  if (first || health.errorCount % 50 === 0) {
    console.error(
      `[geocode] Google Geocoding API rejected the request: ${status}` +
        (message ? ` — ${message}` : "") +
        ` (occurrence ${health.errorCount}). ` +
        `Coordinates are falling back to OpenStreetMap, which resolves few ` +
        `Nigerian street addresses. Check billing and API-key restrictions on ` +
        `the Google Cloud project.`
    )
  }
}

const cache = new Map<string, LatLng>()

async function geocodeViaGoogle(query: string, apiKey?: string): Promise<LatLng | null> {
  const key = apiKey?.trim() || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ""
  if (!key) {
    recordHardFailure(
      "NO_API_KEY",
      "No Google Maps key in Settings → Integrations or NEXT_PUBLIC_GOOGLE_MAPS_KEY"
    )
    return null
  }

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}&region=ng`
  )

  if (!res.ok) {
    recordHardFailure(`HTTP_${res.status}`, res.statusText)
    return null
  }

  const data = (await res.json()) as {
    status?: string
    error_message?: string
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
  }

  const status = data.status ?? "UNKNOWN"

  if (status === "OK") {
    const loc = data.results?.[0]?.geometry?.location
    if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
      // A previously-broken key that starts working again clears the error.
      health.lastError = null
      return { lat: loc.lat, lng: loc.lng }
    }
    return null
  }

  if (SOFT_MISS.has(status)) return null

  // REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST, UNKNOWN_ERROR…
  recordHardFailure(status, data.error_message ?? "")
  return null
}

async function geocodeViaNominatim(query: string, userAgent: string): Promise<LatLng | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json", "User-Agent": userAgent } }
  )
  if (!res.ok) return null

  const data = (await res.json()) as Array<{ lat?: string; lon?: string }>
  const hit = data?.[0]
  if (!hit) return null

  const lat = Number(hit.lat)
  const lng = Number(hit.lon)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null

  return { lat, lng }
}

export type GeocodeOptions = {
  /** Overrides the env key — pass the key resolved from admin settings. */
  apiKey?: string
  userAgent?: string
}

/**
 * Resolve an address to coordinates. Returns null when neither provider can
 * place it. Never throws.
 */
export async function geocodeAddress(
  address: string,
  { apiKey, userAgent = "sg-delivery/1.0" }: GeocodeOptions = {}
): Promise<LatLng | null> {
  const query = address.trim()
  if (!query) return null

  const cached = cache.get(query)
  if (cached) return cached

  let coords: LatLng | null = null

  try {
    coords = await geocodeViaGoogle(query, apiKey)
  } catch (err) {
    recordHardFailure("NETWORK_ERROR", err instanceof Error ? err.message : String(err))
  }

  if (!coords) {
    try {
      coords = await geocodeViaNominatim(query, userAgent)
    } catch {
      return null
    }
  }

  if (coords) cache.set(query, coords)
  return coords
}

const EARTH_RADIUS_KM = 6371

export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return Number((EARTH_RADIUS_KM * c).toFixed(2))
}

const DEFAULT_HUB_COORDS: LatLng = { lat: 6.4642667, lng: 3.5554814 }

export function getHubCoordinates(): LatLng {
  const lat = Number(process.env.NEXT_PUBLIC_HUB_LAT)
  const lng = Number(process.env.NEXT_PUBLIC_HUB_LNG)
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng }
  return DEFAULT_HUB_COORDS
}
