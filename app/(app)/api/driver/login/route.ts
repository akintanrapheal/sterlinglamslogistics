import { NextResponse } from "next/server"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { verifyPassword, isHashed, hashPassword } from "@/lib/password"
import { adminDb } from "@/lib/server/firebase-admin"
import { createLogger } from "@/lib/logger"
import { createDriverToken, buildSessionCookie } from "@/lib/server/driver-session"

const log = createLogger("api:driver:login")

function normalizeDriverPhoneForMatch(value: string): string | null {
  const digits = value.replace(/\D/g, "")
  if (!digits) return null
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1)
  if (digits.length >= 13 && digits.startsWith("234")) return digits.slice(-10)
  if (digits.length > 10) return digits.slice(-10)
  return null
}

export async function POST(req: Request) {
  const rateLimitResponse = await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = (await req.json()) as { phone?: string; password?: string }
    const phone = body.phone?.trim() ?? ""
    const password = body.password?.trim() ?? ""
    if (!phone || !password) {
      return NextResponse.json({ ok: false, error: "Phone and password are required." }, { status: 400 })
    }

    const normalizedInput = normalizeDriverPhoneForMatch(phone)
    if (!normalizedInput) {
      return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 })
    }

    // Try indexed query first (fast path — requires phoneNormalized field on driver docs)
    let driverDocs: FirebaseFirestore.QueryDocumentSnapshot[] = []
    const indexedSnap = await adminDb.collection("drivers")
      .where("phoneNormalized", "==", normalizedInput)
      .limit(5)
      .get()

    if (!indexedSnap.empty) {
      driverDocs = indexedSnap.docs
    } else {
      // Legacy fallback: full scan for drivers without phoneNormalized field.
      // Each successful login via this path backfills the field, so the scan
      // becomes increasingly rare over time and eventually unused.
      const allSnap = await adminDb.collection("drivers").get()
      driverDocs = allSnap.docs.filter((doc) => {
        const stored = normalizeDriverPhoneForMatch(String(doc.data().phone ?? ""))
        return stored === normalizedInput
      })
    }

    for (const driverDoc of driverDocs) {
      const data = driverDoc.data() as { name?: string; phone?: string; password?: string; phoneNormalized?: string }

      const storedPassword = data.password ?? ""
      const matches = await verifyPassword(password, storedPassword)
      if (!matches) continue

      // Hash plaintext passwords on first login (migration path)
      if (!isHashed(storedPassword)) {
        try {
          await driverDoc.ref.update({ password: await hashPassword(password) })
        } catch {
          // best-effort migration only
        }
      }

      // Backfill phoneNormalized so future logins use the fast indexed path
      if (!data.phoneNormalized) {
        driverDoc.ref.update({ phoneNormalized: normalizedInput }).catch(() => {})
      }

      const token = createDriverToken(driverDoc.id)
      const isHttps = new URL(req.url).protocol === "https:"
      const response = NextResponse.json({
        ok: true,
        driver: {
          id: driverDoc.id,
          name: data.name ?? "",
          phone: data.phone ?? "",
        },
        token,
      })
      response.headers.append("Set-Cookie", buildSessionCookie(token, { secure: isHttps }))
      return response
    }

    // The response deliberately stays vague — splitting "no such phone" from
    // "wrong password" would let anyone enumerate which numbers are drivers.
    // The server log is not public, so record which it was: without this a
    // failed login is indistinguishable from a driver record that lost its
    // password field or never came back after a data restore, and the only
    // signal anyone has is a driver insisting the credentials are correct.
    log.warn(
      {
        normalizedInput,
        matchedDrivers: driverDocs.length,
        driversWithoutPassword: driverDocs.filter((d) => !(d.data() as { password?: string }).password).length,
        reason: driverDocs.length === 0 ? "no driver matched phone" : "password mismatch",
      },
      "Driver login rejected",
    )
    return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 })
  } catch (error) {
    log.error({ error }, "Driver login failed")
    return NextResponse.json({ ok: false, error: "Failed to authenticate driver." }, { status: 500 })
  }
}
