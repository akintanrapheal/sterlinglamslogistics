import { NextResponse } from "next/server"
import { adminDb } from "@/lib/server/firebase-admin"
import { verifyDriverSession } from "@/lib/server/driver-session"
import { checkDriverApiRateLimit } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"

const log = createLogger("driver-orders")

export async function GET(req: Request) {
  // Session first, so the rate limit below can be keyed on the driver. The
  // shared IP bucket this used to sit behind was drained by ordinary polling
  // whenever several drivers were on the same carrier NAT.
  const tokenDriverId = verifyDriverSession(req)
  if (!tokenDriverId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const rl = await checkDriverApiRateLimit(tokenDriverId)
  if (rl) return rl

  const { searchParams } = new URL(req.url)
  const driverId = searchParams.get("driverId")

  if (!driverId || driverId !== tokenDriverId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  try {
    const snap = await adminDb
      .collection("orders")
      .where("assignedDriver", "==", driverId)
      .get()

    const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    return NextResponse.json({ ok: true, orders })
  } catch (error) {
    // This was previously swallowed — `error` was bound and never used — so a
    // driver reporting "unable to fetch orders" left nothing behind to
    // diagnose. Log it before returning the generic message.
    log.error({ err: error, driverId }, "Failed to fetch driver orders")
    return NextResponse.json({ ok: false, error: "Failed to fetch orders" }, { status: 500 })
  }
}
