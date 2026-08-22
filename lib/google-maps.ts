/** Shared Google Maps JavaScript API loader (singleton) */

import { apiUrl } from "@/lib/driver-client"

const ENV_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""

let loadPromise: Promise<typeof google.maps> | null = null

/** The key actually used for the last load — also used by the REST helpers
 *  below so they stay in sync with whatever the map itself is using. */
let activeKey = ENV_API_KEY

/**
 * Fetches the key configured in Admin → Settings → Integrations, falling back to
 * the build-time env var. This is what lets a broken key be replaced from the
 * dashboard without redeploying.
 */
async function resolveApiKey(): Promise<string> {
  try {
    // apiUrl, not a bare "/api/maps-key". The static-export APK runs from
    // https://localhost, which serves the bundled UI and no API at all, so the
    // relative form 404'd and fell through to ENV_API_KEY — and build.ps1 sets
    // NEXT_PUBLIC_API_BASE_URL but not NEXT_PUBLIC_GOOGLE_MAPS_KEY, so that was
    // empty too. Maps then loaded with "key=" and rendered a blank white page.
    const res = await fetch(apiUrl("/api/maps-key"))
    if (res.ok) {
      const data = (await res.json()) as { key?: string }
      if (data.key?.trim()) return data.key.trim()
    }
  } catch {
    // Network/API failure — fall back to the build-time key.
  }
  return ENV_API_KEY
}

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("Cannot load Google Maps on the server")
    }

    // Already loaded
    if (window.google?.maps?.Map) return window.google.maps

    activeKey = await resolveApiKey()

    return new Promise<typeof google.maps>((resolve, reject) => {
      const script = document.createElement("script")
      script.src = `https://maps.googleapis.com/maps/api/js?key=${activeKey}&libraries=places`
      script.async = true
      script.defer = true
      script.onload = () => resolve(window.google.maps)
      script.onerror = () => {
        // Allow retries on subsequent calls if the first load fails.
        loadPromise = null
        reject(new Error("Failed to load Google Maps"))
      }
      document.head.appendChild(script)
    })
  })()

  // A rejected load must not poison every later call.
  loadPromise.catch(() => { loadPromise = null })

  return loadPromise
}

/**
 * Discards the cached loader so the next call re-reads the key. Call after
 * saving a new key in settings; a full reload is still needed to swap the
 * already-injected Maps script.
 */
export function resetGoogleMapsLoader(): void {
  loadPromise = null
  // Blank rather than ENV_API_KEY so the next call re-resolves from settings
  // instead of falling back to a stale build-time key.
  activeKey = ""
}

const geocodeCache = new Map<string, { lat: number; lng: number }>()

let geocoderInstance: google.maps.Geocoder | null = null

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const query = address.trim()
  if (!query) return null

  const cached = geocodeCache.get(query)
  if (cached) return cached

  try {
    // Ensure the JS API is loaded first
    await loadGoogleMaps()

    if (!geocoderInstance) {
      geocoderInstance = new google.maps.Geocoder()
    }

    const result = await geocoderInstance.geocode({ address: query })
    const loc = result.results?.[0]?.geometry?.location
    if (!loc) return null

    const coords = { lat: loc.lat(), lng: loc.lng() }
    geocodeCache.set(query, coords)
    return coords
  } catch {
    return null
  }
}

export async function fetchDirectionsRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<{
  polyline: string
  distanceMeters: number
  durationSeconds: number
} | null> {
  try {
    // Use the same key the map itself loaded with, resolving it if no map has
    // been mounted yet on this page.
    const key = activeKey || (await resolveApiKey())
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${key}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const route = data.routes?.[0]
    const leg = route?.legs?.[0]
    if (!route || !leg) return null

    return {
      polyline: route.overview_polyline?.points ?? "",
      distanceMeters: leg.distance?.value ?? 0,
      durationSeconds: leg.duration?.value ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * Optimize the delivery route for a set of orders using Google Maps Directions
 * with `optimizeWaypoints: true`. If `lastStopId` is provided, that order is
 * pinned as the final destination rather than being a waypoint.
 *
 * Returns an ordered array of order IDs representing the optimized sequence.
 */
export async function optimizeRouteOrder(
  driverLocation: { lat: number; lng: number },
  orders: { id: string; lat: number; lng: number }[],
  lastStopId?: string | null,
): Promise<string[]> {
  if (orders.length <= 1) return orders.map((o) => o.id)

  await loadGoogleMaps()
  const directionsService = new google.maps.DirectionsService()

  // If a last stop is chosen, it becomes the destination; remaining are waypoints
  let destination: google.maps.LatLngLiteral
  let waypointOrders: { id: string; lat: number; lng: number }[]

  if (lastStopId) {
    const lastOrder = orders.find((o) => o.id === lastStopId)
    if (!lastOrder) return orders.map((o) => o.id)
    destination = { lat: lastOrder.lat, lng: lastOrder.lng }
    waypointOrders = orders.filter((o) => o.id !== lastStopId)
  } else {
    // Use the last order as a dummy destination; Google will still optimize waypoints
    destination = { lat: orders[orders.length - 1].lat, lng: orders[orders.length - 1].lng }
    waypointOrders = orders.slice(0, -1)
    // Actually we should let Google optimize everything:
    // Put all orders as waypoints except the furthest one as destination
    // But with optimizeWaypoints the destination stays fixed, so use all as waypoints
    // and set destination = driver location (round trip) – or first order.
    // Better approach: use the furthest order from driver as destination.
    let maxDist = -1
    let furthestIdx = orders.length - 1
    for (let i = 0; i < orders.length; i++) {
      const d = Math.pow(orders[i].lat - driverLocation.lat, 2) + Math.pow(orders[i].lng - driverLocation.lng, 2)
      if (d > maxDist) { maxDist = d; furthestIdx = i }
    }
    destination = { lat: orders[furthestIdx].lat, lng: orders[furthestIdx].lng }
    waypointOrders = orders.filter((_, i) => i !== furthestIdx)
    // We'll need to remember the destination order ID
    lastStopId = orders[furthestIdx].id
  }

  const waypoints: google.maps.DirectionsWaypoint[] = waypointOrders.map((o) => ({
    location: { lat: o.lat, lng: o.lng },
    stopover: true,
  }))

  return new Promise((resolve) => {
    directionsService.route(
      {
        origin: driverLocation,
        destination,
        waypoints,
        optimizeWaypoints: true,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result) {
          resolve(orders.map((o) => o.id))
          return
        }

        const waypointOrder = result.routes[0].waypoint_order
        const optimized: string[] = waypointOrder.map((i: number) => waypointOrders[i].id)
        // Append the destination (last stop) at the end
        optimized.push(lastStopId!)
        resolve(optimized)
      },
    )
  })
}
