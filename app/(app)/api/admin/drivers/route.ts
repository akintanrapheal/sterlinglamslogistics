import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { adminCreateDriver, adminDeleteDriver, adminUpdateDriver, adminFetchDriverById } from "@/lib/server/firestore-admin"
import { hashPassword } from "@/lib/password"
import { DRIVER_STATUS } from "@/lib/constants"
import { audit } from "@/lib/audit"
import { createLogger } from "@/lib/logger"
import { checkAdminApiRateLimit } from "@/lib/rate-limit"
import type { Driver } from "@/lib/data"

const log = createLogger("api:admin:drivers")

type Action = "create" | "update" | "delete" | "reset_password" | "set_offline"

export async function POST(req: Request) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await req.json()) as {
      action?: Action
      driverId?: string
      payload?: Record<string, unknown>
    }

    const action = body.action
    if (!action) {
      return NextResponse.json({ ok: false, error: "action is required" }, { status: 400 })
    }

    if (action === "create") {
      const payload = (body.payload ?? {}) as Partial<Driver>
      if (!payload.name || !payload.phone || !payload.email || !payload.password) {
        return NextResponse.json({ ok: false, error: "Missing required driver fields" }, { status: 400 })
      }
      const id = await adminCreateDriver({
        name: String(payload.name),
        phone: String(payload.phone),
        email: String(payload.email),
        vehicle: String(payload.vehicle ?? ""),
        status: (payload.status as Driver["status"]) ?? DRIVER_STATUS.AVAILABLE,
        rating: Number(payload.rating ?? 5),
        password: String(payload.password),
        note: String(payload.note ?? ""),
      })
      await audit({
        action: "driver.created",
        actor: admin.email ?? admin.uid,
        resourceType: "driver",
        resourceId: id,
        details: { target: String(payload.name) },
      })
      return NextResponse.json({ ok: true, id })
    }

    const driverId = body.driverId?.trim()
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "driverId is required" }, { status: 400 })
    }

    // Resolve the driver name for readable audit entries (best-effort).
    const existing = await adminFetchDriverById(driverId).catch(() => null)
    const driverName = existing?.name ?? driverId

    if (action === "delete") {
      await adminDeleteDriver(driverId)
      await audit({
        action: "driver.deleted",
        actor: admin.email ?? admin.uid,
        resourceType: "driver",
        resourceId: driverId,
        details: { target: driverName },
      })
      return NextResponse.json({ ok: true })
    }

    if (action === "set_offline") {
      await adminUpdateDriver(driverId, { status: DRIVER_STATUS.OFFLINE })
      await audit({
        action: "driver.status_changed",
        actor: admin.email ?? admin.uid,
        resourceType: "driver",
        resourceId: driverId,
        details: { target: driverName, status: DRIVER_STATUS.OFFLINE },
      })
      return NextResponse.json({ ok: true })
    }

    if (action === "reset_password") {
      const password = String(body.payload?.password ?? "")
      if (!password) {
        return NextResponse.json({ ok: false, error: "password is required" }, { status: 400 })
      }
      const hashed = await hashPassword(password)
      await adminUpdateDriver(driverId, { password: hashed })
      await audit({
        action: "driver.password_changed",
        actor: admin.email ?? admin.uid,
        resourceType: "driver",
        resourceId: driverId,
        details: { target: driverName },
      })
      return NextResponse.json({ ok: true })
    }

    if (action === "update") {
      await adminUpdateDriver(driverId, (body.payload ?? {}) as Partial<Driver>)
      await audit({
        action: "driver.updated",
        actor: admin.email ?? admin.uid,
        resourceType: "driver",
        resourceId: driverId,
        details: { target: (body.payload as Partial<Driver>)?.name ?? driverName },
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 })
  } catch (error) {
    log.error({ error }, "Admin driver action failed")
    return NextResponse.json({ ok: false, error: "Failed to process driver action" }, { status: 500 })
  }
}
