import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { checkAdminApiRateLimit } from "@/lib/rate-limit"
import { readTrail, lagosDateKey, type TrailPoint } from "@/lib/server/driver-trail"
import { snapTrailToRoads } from "@/lib/server/snap-to-roads"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:driver-trail")

/**
 * One driver's movement history for one day, with the summary computed here.
 *
 * The analysis runs server-side so every consumer agrees on what "distance"
 * and "stopped" mean, and so the client isn't handed a few hundred raw points
 * to reduce on each render.
 */
export const dynamic = "force-dynamic"

/** Below this, consecutive fixes are treated as the same place, not movement. */
const STOP_RADIUS_M = 60

/** Time in one place before it counts as a stop rather than a pause at lights. */
const STOP_MIN_MS = 3 * 60_000

/**
 * Speeds above this are treated as GPS error rather than travel.
 *
 * A reported 196 km/h through Lagos traffic is a fix that jumped, not a
 * driver. 33 m/s is about 120 km/h — above anything these routes can produce,
 * while still leaving expressway speeds intact.
 */
const MAX_PLAUSIBLE_SPEED_MS = 33

/**
 * Jumps larger than this between consecutive fixes are excluded from distance.
 *
 * A GPS fix can leap hundreds of metres when a phone reacquires signal after a
 * tunnel or a spell indoors. Counting those inflates the day's distance with
 * travel that never happened.
 */
const MAX_PLAUSIBLE_JUMP_M = 2000

function metres(a: TrailPoint, b: TrailPoint): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

interface Stop {
  lat: number
  lng: number
  from: number
  to: number
  durationMs: number
}

/**
 * Group consecutive points that stay within STOP_RADIUS_M into stops.
 *
 * Deliberately anchored on the first point of a run rather than a rolling
 * centre: a driver crawling in traffic would otherwise have the centre drift
 * with them and never register as moving.
 */
function detectStops(points: TrailPoint[]): Stop[] {
  const stops: Stop[] = []
  let i = 0

  while (i < points.length) {
    const anchor = points[i]
    let j = i + 1
    while (j < points.length && metres(anchor, points[j]) <= STOP_RADIUS_M) j++

    const last = points[j - 1]
    const durationMs = last.t - anchor.t
    if (j - i > 1 && durationMs >= STOP_MIN_MS) {
      stops.push({
        lat: anchor.lat,
        lng: anchor.lng,
        from: anchor.t,
        to: last.t,
        durationMs,
      })
      i = j
    } else {
      i++
    }
  }

  return stops
}

export async function GET(req: Request) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const rl = await checkAdminApiRateLimit(admin.uid)
  if (rl) return rl

  const { searchParams } = new URL(req.url)
  const driverId = searchParams.get("driverId")
  const date = searchParams.get("date") || lagosDateKey()

  if (!driverId) {
    return NextResponse.json({ ok: false, error: "driverId is required" }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 })
  }

  try {
    const points = await readTrail(driverId, date)

    if (points.length === 0) {
      return NextResponse.json({
        ok: true,
        driverId,
        date,
        points: [],
        stops: [],
        summary: null,
      })
    }

    let distanceM = 0
    let movingMs = 0
    let maxSpeed = 0
    const speeds: number[] = []

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      const d = metres(prev, cur)
      const dt = cur.t - prev.t

      if (d <= MAX_PLAUSIBLE_JUMP_M) {
        distanceM += d
        // Anything beyond the stop radius counts as travelling, so a driver
        // sitting still doesn't accrue "moving" time.
        if (d > STOP_RADIUS_M) movingMs += dt
      }

      // Prefer the device's own speed; derive it only when absent, since a
      // derived figure is distorted by the gap between fixes.
      const s = typeof cur.s === "number" ? cur.s : dt > 0 && d <= MAX_PLAUSIBLE_JUMP_M ? d / (dt / 1000) : 0
      // A derived speed is only as good as the gap it was measured over, so
      // implausible values are discarded rather than reported as a maximum.
      if (s > 0 && s <= MAX_PLAUSIBLE_SPEED_MS) {
        speeds.push(s)
        if (s > maxSpeed) maxSpeed = s
      }
    }

    // Snap to the road network unless explicitly asked not to. Raw fixes drift
    // and are sampled, so drawn directly they cut across blocks and round off
    // corners. Falls back to raw points when snapping is unavailable — an
    // approximate route beats an empty map.
    const wantSnap = searchParams.get("snap") !== "0"
    const snapped = wantSnap ? await snapTrailToRoads(points) : null

    const stops = detectStops(points)
    const stoppedMs = stops.reduce((sum, s) => sum + s.durationMs, 0)
    const firstSeen = points[0].t
    const lastSeen = points[points.length - 1].t

    return NextResponse.json({
      ok: true,
      driverId,
      date,
      points,
      // The drawn line, which may be the road-matched version. Stops and the
      // summary stay on raw points: snapping moves a fix onto the nearest
      // road, which would nudge a stop away from where the driver actually
      // waited and slightly alter measured distance.
      path: snapped ?? points.map((p) => ({ lat: p.lat, lng: p.lng })),
      snapped: Boolean(snapped),
      stops,
      summary: {
        distanceKm: Number((distanceM / 1000).toFixed(2)),
        movingMs,
        stoppedMs,
        // Average of recorded speeds rather than distance/time, which a long
        // lunch stop would otherwise drag towards zero.
        avgSpeedKmh: speeds.length
          ? Number(((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 3.6).toFixed(1))
          : 0,
        maxSpeedKmh: Number((maxSpeed * 3.6).toFixed(1)),
        stopCount: stops.length,
        pointCount: points.length,
        firstSeen,
        lastSeen,
      },
    })
  } catch (error) {
    log.error({ err: error, driverId, date }, "Failed to build driver trail")
    return NextResponse.json({ ok: false, error: "Failed to load driver trail" }, { status: 500 })
  }
}
