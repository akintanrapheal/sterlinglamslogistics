import { NextResponse } from "next/server"
import { checkRateLimit, checkDriverApiRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { adminUpdateDriver, adminFetchDriverById } from "@/lib/server/firestore-admin"
import { hashPassword, verifyPassword } from "@/lib/password"
import { createLogger } from "@/lib/logger"
import { resolveDriverIdFromRequest } from "@/lib/server/driver-auth"

const log = createLogger("api:driver:profile")

export async function GET(req: Request) {
  // Identify first, then rate limit per driver. The driver app polls this
  // route every 10 s, so on the old shared IP bucket (20/60 s) a handful of
  // drivers behind one carrier NAT exhausted it on polling alone and every
  // other driver call started failing.
  const driverId = resolveDriverIdFromRequest(req)
  if (!driverId) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const rateLimitResponse = await checkDriverApiRateLimit(driverId)
  if (rateLimitResponse) return rateLimitResponse

  try {
    const driver = await adminFetchDriverById(driverId)
    if (!driver) {
      return NextResponse.json({ ok: false, error: "Driver not found." }, { status: 404 })
    }
    // Strip the password hash before sending to the client
    const { password: _pw, ...safeDriver } = driver as typeof driver & { password?: unknown }
    return NextResponse.json({ ok: true, driver: safeDriver })
  } catch (error) {
    log.error({ error, driverId }, "Failed to fetch driver profile")
    return NextResponse.json({ ok: false, error: "Failed to fetch profile." }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const rateLimitResponse = await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = (await req.json()) as {
      driverId?: string
      name?: string
      email?: string
      phone?: string
      vehicle?: string
      area?: string
      model?: string
      plate?: string
      currentPassword?: string
      newPassword?: string
    }

    const driverId = resolveDriverIdFromRequest(req, body.driverId)
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
    }

    const updates: Record<string, unknown> = {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.email === "string" ? { email: body.email.trim() } : {}),
      ...(typeof body.phone === "string" ? { phone: body.phone.trim() } : {}),
      ...(typeof body.vehicle === "string" ? { vehicle: body.vehicle.trim() } : {}),
      ...(typeof body.area === "string" ? { area: body.area.trim() } : {}),
      ...(typeof body.model === "string" ? { model: body.model.trim() } : {}),
      ...(typeof body.plate === "string" ? { plate: body.plate.trim() } : {}),
    }

    // Password change — requires current password verification
    if (body.newPassword) {
      if (!body.currentPassword) {
        return NextResponse.json({ ok: false, error: "Current password is required." }, { status: 400 })
      }
      if (body.newPassword.length < 6) {
        return NextResponse.json({ ok: false, error: "New password must be at least 6 characters." }, { status: 400 })
      }
      const driver = await adminFetchDriverById(driverId)
      if (!driver) {
        return NextResponse.json({ ok: false, error: "Driver not found." }, { status: 404 })
      }
      const currentHash = (driver as unknown as Record<string, unknown>).password as string | undefined
      if (!currentHash || !(await verifyPassword(body.currentPassword, currentHash))) {
        return NextResponse.json({ ok: false, error: "Current password is incorrect." }, { status: 403 })
      }
      updates.password = await hashPassword(body.newPassword)
    }

    await adminUpdateDriver(driverId, updates)

    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error({ error }, "Driver profile update failed")
    return NextResponse.json({ ok: false, error: "Failed to update driver profile." }, { status: 500 })
  }
}
