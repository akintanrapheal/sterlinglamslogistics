import { NextResponse } from "next/server"
import { adminCleanOrderNumbersWC, adminRemoveDuplicateOrders, adminBackfillOrderCoords } from "@/lib/server/firestore-admin"
import { createLogger } from "@/lib/logger"
import { audit } from "@/lib/audit"
import { verifyAdmin } from "@/lib/server/auth"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"

const log = createLogger("api:admin:clean-orders")

export async function POST(req: Request) {
  const rateLimitResponse = await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const prefixesCleaned = await adminCleanOrderNumbersWC()
    const duplicatesRemoved = await adminRemoveDuplicateOrders()
    const coords = await adminBackfillOrderCoords()

    const details = {
      prefixesCleaned,
      duplicatesRemoved,
      coordsBackfilled: coords.updated,
      coordsFailed: coords.failed,
      geocoderError: coords.geocoderError,
    }
    log.info(details, "Clean orders completed")
    if (coords.geocoderError) {
      log.error(
        { geocoderError: coords.geocoderError, coordsFailed: coords.failed },
        "Geocoding is misconfigured — orders were left without coordinates"
      )
    }
    await audit({ action: "admin.clean_orders", actor: admin.uid, details })

    return NextResponse.json({
      ok: true,
      prefixesCleaned,
      duplicatesRemoved,
      coordsBackfilled: coords.updated,
      coordsFailed: coords.failed,
      geocoderError: coords.geocoderError,
    })
  } catch (error) {
    log.error({ error }, "Clean orders failed")
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
