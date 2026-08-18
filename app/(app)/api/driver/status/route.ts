import { NextResponse } from "next/server"
import { checkRateLimit, checkDriverApiRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { adminUpdateDriver } from "@/lib/server/firestore-admin"
import { createLogger } from "@/lib/logger"
import type { DriverStatus } from "@/lib/data"
import { resolveDriverIdFromRequest } from "@/lib/server/driver-auth"

const log = createLogger("api:driver:status")

export async function POST(req: Request) {
  // Per-driver where a token identifies one, IP otherwise. See
  // checkDriverApiRateLimit for why the shared IP bucket was the problem.
  const tokenDriverId = resolveDriverIdFromRequest(req)
  const rateLimitResponse = tokenDriverId
    ? await checkDriverApiRateLimit(tokenDriverId)
    : await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = (await req.json()) as { driverId?: string; status?: string }
    const status = body.status?.trim()

    const driverId = resolveDriverIdFromRequest(req, body.driverId)
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
    }
    if (!status) {
      return NextResponse.json({ ok: false, error: "status is required." }, { status: 400 })
    }
    if (!["offline", "available", "on-delivery"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Unsupported status." }, { status: 400 })
    }

    await adminUpdateDriver(driverId, { status: status as DriverStatus })
    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error({ error }, "Driver status update failed")
    return NextResponse.json({ ok: false, error: "Failed to update status." }, { status: 500 })
  }
}
