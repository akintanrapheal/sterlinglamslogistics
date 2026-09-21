import { NextResponse } from "next/server"
import { adminDb } from "@/lib/server/firebase-admin"
import { verifyManager } from "@/lib/server/auth"
import { audit } from "@/lib/audit"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:prune-audit-logs")

// Audit entries older than this are deleted. Override with env if needed.
const RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 90

/**
 * Driver location trails are kept for a shorter window than audit logs.
 *
 * They are operational — reviewing where a driver went this week — rather
 * than a compliance record, and they are far bulkier per day. Keeping them
 * indefinitely would grow storage without anyone reading them, and precise
 * movement history of named people is not something to retain longer than
 * it is actually useful.
 */
const TRAIL_RETENTION_DAYS = Number(process.env.DRIVER_TRAIL_RETENTION_DAYS) || 30

// Firestore caps a batch at 500 writes. Cap total batches per run so a huge
// backlog can't blow the serverless timeout — leftovers are cleared next run.
const BATCH_SIZE = 500
const MAX_BATCHES = 40 // up to 20k deletions per invocation

/**
 * Prune old audit logs.
 *
 * Auth: either a Vercel Cron call (Authorization: Bearer $CRON_SECRET, sent
 * automatically when CRON_SECRET is set in the project env) or a manual
 * owner/admin request. Vercel Cron uses GET.
 */
async function prune(req: Request) {
  // 1. Authorize: cron secret OR a signed-in manager.
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isCron) {
    const manager = await verifyManager(req)
    if (!manager) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  try {
    let deleted = 0
    let batches = 0

    while (batches < MAX_BATCHES) {
      // Single-field range filter — no composite index required.
      const snap = await adminDb
        .collection("auditLogs")
        .where("createdAt", "<", cutoff)
        .orderBy("createdAt", "asc")
        .limit(BATCH_SIZE)
        .get()

      if (snap.empty) break

      const batch = adminDb.batch()
      snap.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()

      deleted += snap.size
      batches += 1

      // Fewer than a full page means we've reached the end.
      if (snap.size < BATCH_SIZE) break
    }

    // Prune driver trails in the same run. Keyed on the YYYY-MM-DD `date`
    // field rather than a timestamp, so this is a string comparison on a
    // single field and needs no composite index.
    const trailCutoff = new Date(Date.now() - TRAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const trailCutoffKey = new Date(trailCutoff.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10)
    let trailsDeleted = 0
    try {
      for (let b = 0; b < MAX_BATCHES; b++) {
        const snap = await adminDb
          .collection("driverTrails")
          .where("date", "<", trailCutoffKey)
          .orderBy("date", "asc")
          .limit(BATCH_SIZE)
          .get()
        if (snap.empty) break
        const batch = adminDb.batch()
        snap.docs.forEach((doc) => batch.delete(doc.ref))
        await batch.commit()
        trailsDeleted += snap.size
        if (snap.size < BATCH_SIZE) break
      }
    } catch (err) {
      // Never let trail pruning fail the audit prune it rides along with.
      log.warn({ err }, "Failed to prune driver trails")
    }

    const more = batches >= MAX_BATCHES
    log.info(
      { deleted, trailsDeleted, batches, cutoff: cutoff.toISOString(), more },
      "Pruned audit logs and driver trails",
    )

    // Record the prune itself (skip when nothing was removed, to avoid noise).
    if (deleted > 0) {
      await audit({
        action: "audit.pruned",
        actor: isCron ? "system:cron" : "manual",
        resourceType: "settings",
        details: { count: deleted, olderThanDays: RETENTION_DAYS, more },
      })
    }

    return NextResponse.json({
      ok: true,
      deleted,
      olderThanDays: RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
      more, // true if more remain (will be cleared on the next run)
    })
  } catch (error) {
    log.error({ error }, "Failed to prune audit logs")
    return NextResponse.json({ error: "Failed to prune audit logs" }, { status: 500 })
  }
}

// Vercel Cron invokes the route with GET; POST allows manual admin triggering.
export async function GET(req: Request) {
  return prune(req)
}

export async function POST(req: Request) {
  return prune(req)
}
