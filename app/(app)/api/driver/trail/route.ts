import { NextResponse } from "next/server"
import { resolveDriverIdFromRequest } from "@/lib/server/driver-auth"
import { checkDriverApiRateLimit } from "@/lib/rate-limit"
import { appendTrailPoints, type TrailPoint } from "@/lib/server/driver-trail"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:driver:trail")

/**
 * Bulk upload of buffered location history.
 *
 * Separate from /api/driver/location, which reports where a driver is now.
 * This reports where they have been, and arrives in batches: a device that
 * was out of coverage can return with hours of points, and sending those one
 * request at a time would be hundreds of round trips and would exhaust the
 * driver's rate limit before the backlog cleared.
 */
export const dynamic = "force-dynamic"

/** Points accepted per request. Matches the client's batch size. */
const MAX_POINTS = 500

export async function POST(req: Request) {
  const driverId = resolveDriverIdFromRequest(req)
  if (!driverId) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const rl = await checkDriverApiRateLimit(driverId)
  if (rl) return rl

  try {
    const body = (await req.json()) as { points?: unknown }
    if (!Array.isArray(body.points)) {
      return NextResponse.json({ ok: false, error: "points array is required." }, { status: 400 })
    }

    const now = Date.now()
    const points: TrailPoint[] = []

    for (const raw of body.points.slice(0, MAX_POINTS)) {
      if (!raw || typeof raw !== "object") continue
      const p = raw as { lat?: unknown; lng?: unknown; t?: unknown; s?: unknown }
      if (typeof p.lat !== "number" || typeof p.lng !== "number") continue
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
      if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue

      // Timestamps come from the device, so they are only as trustworthy as
      // its clock. Reject anything in the future or implausibly old rather
      // than filing a point under a date it could not have happened on.
      const t = typeof p.t === "number" && Number.isFinite(p.t) ? p.t : now
      if (t > now + 60_000 || t < now - 30 * 24 * 60 * 60 * 1000) continue

      points.push({
        lat: p.lat,
        lng: p.lng,
        t,
        ...(typeof p.s === "number" && Number.isFinite(p.s) && p.s >= 0 ? { s: p.s } : {}),
      })
    }

    if (points.length === 0) {
      // Nothing usable, but the upload itself succeeded — report ok so the
      // client clears the batch instead of retrying malformed points forever.
      return NextResponse.json({ ok: true, accepted: 0 })
    }

    await appendTrailPoints(driverId, points)
    return NextResponse.json({ ok: true, accepted: points.length })
  } catch (error) {
    log.error({ err: error, driverId }, "Failed to store trail batch")
    return NextResponse.json({ ok: false, error: "Failed to store trail." }, { status: 500 })
  }
}
