import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { getServerMapsKey, invalidateMapsKeyCache } from "@/lib/server/maps-key"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:test-maps-key")

/** Plain-language explanation for each Google status, so the admin knows what
 *  to actually go and fix. */
const REMEDY: Record<string, string> = {
  OK: "Key is working.",
  REQUEST_DENIED:
    "Google rejected this key. Most often billing is disabled on the Google Cloud project, or the key is restricted so it cannot be used from the server.",
  OVER_QUERY_LIMIT:
    "This key has exceeded its quota or daily spending cap. Raise the cap in Google Cloud, or wait for the quota to reset.",
  INVALID_REQUEST: "The test request was malformed — this is a bug, not a key problem.",
  ZERO_RESULTS:
    "Key works, but the test address returned no match. Geocoding is reachable.",
  UNKNOWN_ERROR: "Google had a transient server error. Try again in a moment.",
  NO_KEY: "No key is configured in settings or in NEXT_PUBLIC_GOOGLE_MAPS_KEY.",
}

export async function POST(req: Request) {
  const rateLimitResponse = await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  // A key may be supplied to test *before* saving it; otherwise test the
  // currently active one.
  let candidate = ""
  try {
    const body = (await req.json()) as { key?: unknown }
    if (typeof body.key === "string") candidate = body.key.trim()
  } catch {
    // No body — fall through to the saved key.
  }

  // Settings may have just been written, so bypass the TTL cache.
  invalidateMapsKeyCache()
  const key = candidate || (await getServerMapsKey())

  if (!key) {
    return NextResponse.json({
      ok: false,
      status: "NO_KEY",
      message: REMEDY.NO_KEY,
    })
  }

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=Lagos,+Nigeria&key=${encodeURIComponent(key)}`
    )
    const data = (await res.json()) as { status?: string; error_message?: string }
    const status = data.status ?? `HTTP_${res.status}`
    const working = status === "OK" || status === "ZERO_RESULTS"

    log.info({ status, actor: admin.uid }, "Google Maps key tested")

    return NextResponse.json({
      ok: working,
      status,
      // Google's own message is the most precise signal — pass it through.
      message: data.error_message || REMEDY[status] || "Unrecognised response from Google.",
      remedy: REMEDY[status] ?? null,
    })
  } catch (error) {
    log.error({ error }, "Google Maps key test failed")
    return NextResponse.json(
      {
        ok: false,
        status: "NETWORK_ERROR",
        message: "Could not reach the Google Maps API from the server.",
      },
      { status: 502 }
    )
  }
}
