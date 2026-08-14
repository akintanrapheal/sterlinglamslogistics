import { NextResponse } from "next/server"
import { verifyDriverSession } from "@/lib/server/driver-session"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { geocodeAddress, getGeocodeHealth } from "@/lib/geocode"
import { getServerMapsKey } from "@/lib/server/maps-key"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:driver:geocode")

export async function GET(req: Request) {
  const rl = await checkRateLimit(getRateLimitIdentifier(req))
  if (rl) return rl

  const tokenDriverId = verifyDriverSession(req)
  if (!tokenDriverId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const address = searchParams.get("address")
  if (!address) return NextResponse.json({ ok: false, error: "address required" }, { status: 400 })

  // Google Geocoding with an OpenStreetMap fallback; config failures (billing,
  // key restrictions, quota) are logged rather than silently swallowed.
  const coords = await geocodeAddress(address.trim(), {
    apiKey: await getServerMapsKey(),
    userAgent: "sterlinglams-delivery/1.0",
  })
  if (coords) return NextResponse.json({ ok: true, lat: coords.lat, lng: coords.lng })

  const health = getGeocodeHealth()
  if (health.lastError) {
    // Not the driver's fault and not a bad address — the geocoder is down.
    log.error(
      { status: health.lastError.status, message: health.lastError.message },
      "Geocoding provider is misconfigured"
    )
    return NextResponse.json(
      { ok: false, error: "Geocoding temporarily unavailable" },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
}
