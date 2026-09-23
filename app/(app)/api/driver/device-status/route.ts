import { NextResponse } from "next/server"
import { resolveDriverIdFromRequest } from "@/lib/server/driver-auth"
import { checkDriverApiRateLimit } from "@/lib/rate-limit"
import { adminDb } from "@/lib/server/firebase-admin"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:driver:device-status")

/**
 * Report whether a driver's phone is still protected against the app being
 * removed.
 *
 * Device admin rights can be revoked from Android's settings, so the app
 * cannot prevent its own removal outright. What it can do is make the attempt
 * visible: the last thing that happens before an uninstall is the rights
 * being revoked, and that is worth knowing about.
 *
 * The check is stored rather than merely logged so the office can see, per
 * driver, which company phones are still protected — a phone that quietly
 * lost protection weeks ago is the one that goes missing.
 */
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const driverId = resolveDriverIdFromRequest(req)
  if (!driverId) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const rl = await checkDriverApiRateLimit(driverId)
  if (rl) return rl

  try {
    const body = (await req.json()) as {
      isAdmin?: unknown
      deviceOwner?: unknown
      uninstallBlocked?: unknown
      adminDisabledAt?: unknown
    }

    const isAdmin = body.isAdmin === true
    const deviceOwner = body.deviceOwner === true
    const disabledAt =
      typeof body.adminDisabledAt === "number" && body.adminDisabledAt > 0
        ? new Date(body.adminDisabledAt)
        : null

    await adminDb.collection("drivers").doc(driverId).update({
      deviceProtection: {
        isAdmin,
        deviceOwner,
        uninstallBlocked: isAdmin || deviceOwner,
        // Kept rather than overwritten with null on later reports: a
        // revocation is exactly the event worth remembering, and the driver
        // re-granting rights afterwards should not erase that it happened.
        ...(disabledAt ? { lastRevokedAt: disabledAt } : {}),
      },
      deviceProtectionAt: new Date(),
    })

    if (disabledAt) {
      log.warn(
        { driverId, disabledAt: disabledAt.toISOString() },
        "Driver revoked device admin — app can now be uninstalled",
      )
    }

    return NextResponse.json({ ok: true, acknowledgedRevocation: Boolean(disabledAt) })
  } catch (error) {
    log.error({ err: error, driverId }, "Failed to record device status")
    return NextResponse.json({ ok: false, error: "Failed to record device status." }, { status: 500 })
  }
}
