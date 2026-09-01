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

    // Active orders are always fetched on their own, never as a slice of
    // history. They are the driver's actual work, and a bounded history query
    // can silently exclude them: ordering by document id rather than date
    // returned an arbitrary 200 delivered orders and dropped the one job the
    // driver still had to do.
    const activeSnap = await base.where("status", "in", ACTIVE_STATUSES).get()
    const activeOrders = activeSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    if (scope === "active") {
      return NextResponse.json({ ok: true, orders: activeOrders })
    }

    // History, ordered by when the delivery completed rather than when the
    // order was created.
    //
    // Ordering by createdAt made the window "the 200 most recently created
    // orders", so an older order delivered today fell outside it once 200
    // newer orders existed — the driver's Completed Orders simply stopped
    // updating while the endpoint reported success. deliveredAt is the field
    // this screen actually sorts and groups by, so it is the one that should
    // bound the page.
    //
    // Firestore omits documents missing the ordered field, which is correct
    // here: undelivered orders are not history, and the active ones are
    // fetched separately above and merged below.
    //
    // Needs a composite index (see firestore.indexes.json). If it hasn't been
    // deployed the query is rejected outright, so fall back to an unordered
    // page rather than failing the request — history is then approximate
    // instead of absent, and active orders are unaffected either way.
    let historyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = []
    try {
      const snap = await base.orderBy("deliveredAt", "desc").limit(MAX_HISTORY_ORDERS).get()
      historyDocs = snap.docs
    } catch (err) {
      log.warn(
        { err, driverId },
        "Ordered history query failed — falling back to unordered page. Deploy the assignedDriver+deliveredAt index.",
      )
      // Narrow the unordered fallback to delivered orders. Without an
      // orderBy the limit selects by document id, so the page is arbitrary
      // either way — but an arbitrary page of history beats one padded with
      // cancelled and failed orders that this screen never shows.
      const snap = await base.where("status", "==", "delivered").limit(MAX_HISTORY_ORDERS).get()
      historyDocs = snap.docs
    }

    // Merge, letting active orders win so they can't be crowded out.
    const byId = new Map<string, Record<string, unknown>>()
    for (const doc of historyDocs) byId.set(doc.id, { id: doc.id, ...doc.data() })
    for (const o of activeOrders) byId.set(o.id, o)

    const ms = (v: unknown): number => {
      if (!v || typeof v !== "object") return 0
      const t = v as { _seconds?: number; seconds?: number }
      return (t._seconds ?? t.seconds ?? 0) * 1000
    }
    // Sort on the same field the window is bounded by, so the order the client
    // sees matches the order the page was selected in. Active orders have no
    // deliveredAt, so they fall back to createdAt and sort to the top, which
    // is where current work belongs.
    const sortKey = (o: Record<string, unknown>) =>
      ms(o.deliveredAt) || ms(o.createdAt)
    const orders = [...byId.values()].sort((a, b) => sortKey(b) - sortKey(a))

    return NextResponse.json({ ok: true, orders })
  } catch (error) {
    // This was previously swallowed — `error` was bound and never used — so a
    // driver reporting "unable to fetch orders" left nothing behind to
    // diagnose. Log it before returning the generic message.
    log.error({ err: error, driverId }, "Failed to fetch driver orders")
    return NextResponse.json({ ok: false, error: "Failed to fetch orders" }, { status: 500 })
  }
}
