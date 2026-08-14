import { NextResponse } from "next/server"
import { adminDb } from "@/lib/server/firebase-admin"
import { verifyAdmin, verifyManager } from "@/lib/server/auth"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { audit, type AuditAction } from "@/lib/audit"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:activity")

// Actions a dashboard client is allowed to record about itself. User- and
// driver-management actions are written server-side only (from their own
// routes) so they can't be forged from the browser.
const CLIENT_LOGGABLE_ACTIONS: AuditAction[] = [
  "order.created",
  "order.updated",
  "order.deleted",
  "order.assigned",
  "order.status_changed",
  "settings.updated",
]

// settings.updated additionally requires owner/admin (the settings UI is
// already gated to managers; this enforces it at the API too).
const MANAGER_ONLY_ACTIONS: AuditAction[] = ["settings.updated"]

/** Normalise a Firestore Timestamp / Date / ISO string to an ISO string. */
function toIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  const anyVal = value as { toDate?: () => Date; toISOString?: () => string }
  if (typeof anyVal.toDate === "function") return anyVal.toDate().toISOString()
  if (typeof anyVal.toISOString === "function") return anyVal.toISOString()
  return null
}

/** GET /api/admin/activity — recent audit entries (owner/admin only). */
export async function GET(req: Request) {
  const rl = await checkRateLimit(getRateLimitIdentifier(req))
  if (rl) return rl

  const manager = await verifyManager(req)
  if (!manager) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const actor = url.searchParams.get("actor")
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500)

  try {
    // Order + limit in Firestore; filter by actor in memory to avoid a composite index.
    const snap = await adminDb
      .collection("auditLogs")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get()

    let entries = snap.docs.map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        action: d.action ?? "",
        actor: d.actor ?? null,
        resourceType: d.resourceType ?? null,
        resourceId: d.resourceId ?? null,
        details: d.details ?? null,
        timestamp: toIso(d.createdAt) ?? d.timestamp ?? null,
      }
    })

    if (actor) entries = entries.filter((e) => e.actor === actor)

    return NextResponse.json({ entries })
  } catch (error) {
    log.error({ error }, "Failed to load activity log")
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 })
  }
}

/**
 * POST /api/admin/activity — record a client-side action (orders).
 * Any signed-in dashboard user may log their own order actions; the actor is
 * taken from the verified token, never from the request body.
 */
export async function POST(req: Request) {
  const rl = await checkRateLimit(getRateLimitIdentifier(req))
  if (rl) return rl

  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: {
    action?: AuditAction
    resourceId?: string
    details?: Record<string, unknown>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.action || !CLIENT_LOGGABLE_ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
  }

  if (MANAGER_ONLY_ACTIONS.includes(body.action)) {
    const manager = await verifyManager(req)
    if (!manager) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await audit({
    action: body.action,
    actor: admin.email ?? admin.uid,
    // Resource type is implied by the action prefix (order.* / settings.*).
    resourceType: body.action.startsWith("settings.") ? "settings" : "order",
    resourceId: body.resourceId,
    details: body.details,
  })

  return NextResponse.json({ ok: true })
}
