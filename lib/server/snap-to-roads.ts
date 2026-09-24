import { getServerMapsKey } from "./maps-key"
import { createLogger } from "@/lib/logger"
import type { TrailPoint } from "./driver-trail"

const log = createLogger("snap-to-roads")

/**
 * Align a GPS trail to the road network.
 *
 * Raw fixes drift by several metres and are sampled at intervals, so drawing
 * them directly produces a line that cuts across blocks and rounds off
 * corners — the route is recognisable but visibly not on the roads.
 *
 * Google's Roads API matches each point to the nearest road segment, and with
 * interpolate=true it also returns the road geometry *between* the supplied
 * points. That second part is what makes a turn look like a turn: the corner
 * is drawn from the road's own shape rather than inferred from two fixes
 * either side of it.
 */

/** Roads API accepts at most 100 points per request. */
const BATCH = 100

/**
 * Points shared between consecutive batches.
 *
 * Without an overlap each batch is snapped in isolation and the joins show as
 * small kinks where one ends and the next begins. Repeating the last few
 * points gives the next request context to match against.
 */
const OVERLAP = 2

export interface SnappedPoint {
  lat: number
  lng: number
}

/**
 * Snap a trail to roads. Returns null when snapping is unavailable, so the
 * caller can fall back to raw points rather than showing nothing — an
 * approximate route is far more useful than an empty map.
 */
export async function snapTrailToRoads(points: TrailPoint[]): Promise<SnappedPoint[] | null> {
  if (points.length < 2) return null

  const key = await getServerMapsKey()
  if (!key) {
    log.warn("No Maps key configured — skipping road snapping")
    return null
  }

  const out: SnappedPoint[] = []

  try {
    for (let start = 0; start < points.length; start += BATCH - OVERLAP) {
      const batch = points.slice(start, start + BATCH)
      if (batch.length < 2) break

      const path = batch.map((p) => `${p.lat},${p.lng}`).join("|")
      const url =
        `https://roads.googleapis.com/v1/snapToRoads` +
        `?path=${encodeURIComponent(path)}&interpolate=true&key=${encodeURIComponent(key)}`

      const res = await fetch(url)
      if (!res.ok) {
        log.warn({ status: res.status }, "Roads API request failed")
        return null
      }

      const data = (await res.json()) as {
        snappedPoints?: Array<{ location: { latitude: number; longitude: number } }>
        error?: { message?: string; status?: string }
      }

      if (data.error) {
        // Most often the Roads API is not enabled on the project, which is a
        // separate toggle from Maps JavaScript and easy to miss.
        log.warn({ error: data.error }, "Roads API returned an error")
        return null
      }

      const snapped = (data.snappedPoints ?? []).map((sp) => ({
        lat: sp.location.latitude,
        lng: sp.location.longitude,
      }))

      // Drop the overlap region from every batch after the first, or the
      // shared points appear twice and the line backtracks over itself.
      out.push(...(start === 0 ? snapped : snapped.slice(OVERLAP)))
    }

    return out.length >= 2 ? out : null
  } catch (err) {
    log.warn({ err }, "Road snapping failed — falling back to raw points")
    return null
  }
}
