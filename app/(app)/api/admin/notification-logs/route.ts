import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { adminDb } from "@/lib/server/firebase-admin"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:notification-logs")

/**
 * Notification log history for the admin page.
 *
 * Read through the admin SDK on the server rather than a client-side
 * subscription. The admin app already learned that lesson expensively:
 * unbounded realtime listeners re-read a whole collection on every page
 * mount and exhausted the Firestore read quota. This is bounded, paged, and
 * fetched only when asked for.
 */
export const dynamic = "force-dynamic"

const MAX_PAGE = 200

export async function GET(req: Request) {
  const rl = await checkRateLimit(getRateLimitIdentifier(req))
  if (rl) return rl

  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get("limit")) || 50, MAX_PAGE)
  const event = searchParams.get("event")
  // Cursor is the createdAt of the last row already shown, in epoch ms.
  const before = Number(searchParams.get("before")) || null

  try {
    let q = adminDb
      .collection("notificationLogs")
      .orderBy("createdAt", "desc")
      .limit(limit)

    // Equality filter plus the orderBy above needs a composite index. Rather
    // than make the page depend on one being deployed, filter by event in
    // memory below and keep the query single-field.
    if (before) q = q.where("createdAt", "<", new Date(before)) as typeof q

    const snap = await q.get()
    let logs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<
      Record<string, unknown> & { event?: string }
    >

    if (event && event !== "all") logs = logs.filter((l) => l.event === event)

    return NextResponse.json({ ok: true, logs, hasMore: snap.docs.length === limit })
  } catch (error) {
    log.error({ err: error }, "Failed to read notification logs")
    return NextResponse.json({ ok: false, error: "Failed to load notification logs" }, { status: 500 })
  }
}
