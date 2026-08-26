import { NextResponse } from "next/server"
import { adminDb } from "@/lib/server/firebase-admin"
import { verifyDriverSession } from "@/lib/server/driver-session"
import { checkDriverApiRateLimit } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"

const log = createLogger("driver-orders")

/** Statuses a driver still has work to do on. */
const ACTIVE_STATUSES = ["unassigned", "started", "picked-up", "in-transit"] as const

/** Upper bound for history reads, so "all" can't become unbounded again. */
const MAX_HISTORY_ORDERS = 200

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

  // Scope the read. This route is polled continuously by every online
  // driver, and it used to fetch the driver's entire order history on each
  // call — unbounded, so the cost grew with every delivery they ever made.
  // A driver with 50 lifetime orders generated well over 200k document reads
  // a day on their own, which is how a free-tier Firestore quota (50k/day)
  // gets exhausted and every server read starts failing with
  // RESOURCE_EXHAUSTED.
  //
  // "active" is what the polling path actually needs: the current workload,
  // typically a handful of documents. "all" is for screens that genuinely
  // need history, and is bounded rather than open-ended.
  // Defaults to "all" so a client that doesn't know about this parameter keeps
  // the behaviour it was built against. Defaulting to "active" silently broke
  // already-installed APKs: they ask without a scope, so Completed Orders and
  // Performance suddenly saw no delivered orders at all. "all" is bounded, so
  // an older client is merely less efficient rather than wrong — the polling
  // path asks for "active" explicitly.
  const scope = searchParams.get("scope") === "active" ? "active" : "all"

  try {
    const base = adminDb.collection("orders").where("assignedDriver", "==", driverId)

    // No orderBy on the history query. Combining an equality filter with
    // orderBy on a different field needs a composite index, and without one
    // Firestore rejects the query outright — which is exactly what happened:
    // scope=all returned a 500 while scope=active worked, so Completed Orders
    // and Performance came up empty. Sorting a driver's own orders in memory
    // avoids the index entirely and costs nothing at this size.
    const snap = await (scope === "active"
      ? base.where("status", "in", ACTIVE_STATUSES).get()
      : base.limit(MAX_HISTORY_ORDERS).get())

    const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    if (scope === "all") {
      // Newest first. Admin SDK timestamps serialise as _seconds, and orders
      // predating a field are sorted last rather than dropped.
      const ms = (v: unknown): number => {
        if (!v || typeof v !== "object") return 0
        const t = v as { _seconds?: number; seconds?: number }
        return (t._seconds ?? t.seconds ?? 0) * 1000
      }
      orders.sort((a, b) => ms((b as { createdAt?: unknown }).createdAt) - ms((a as { createdAt?: unknown }).createdAt))
    }
    return NextResponse.json({ ok: true, orders })
  } catch (error) {
    // This was previously swallowed — `error` was bound and never used — so a
    // driver reporting "unable to fetch orders" left nothing behind to
    // diagnose. Log it before returning the generic message.
    log.error({ err: error, driverId }, "Failed to fetch driver orders")
    return NextResponse.json({ ok: false, error: "Failed to fetch orders" }, { status: 500 })
  }
}
