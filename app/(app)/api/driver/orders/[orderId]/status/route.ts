import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { adminUpdateDriver, adminFetchDriverById } from "@/lib/server/firestore-admin"
import { adminDb, adminStorage } from "@/lib/server/firebase-admin"
import { createLogger } from "@/lib/logger"
import { resolveDriverIdFromRequest } from "@/lib/server/driver-auth"
import { notifyOrderEventServer } from "@/lib/server/notify-order-event"
import { notifyStoreDelivered } from "@/lib/server/notify-store-delivered"
import type { Order } from "@/lib/data"
import type { OrderEvent } from "@/lib/server/notifications"

const log = createLogger("api:driver:order-status")

/**
 * Upload a base64 data URL (JPEG or SVG) to Firebase Storage and return a
 * stable Firebase download URL. Uses a download token embedded in the file
 * metadata so the URL works without public ACLs (makePublic is not used —
 * uniform bucket-level access blocks object ACLs on modern Firebase buckets).
 */
// Only these MIME types are accepted as proof-of-delivery uploads.
// Rejecting arbitrary MIME types prevents serving executable content
// (HTML, JS, SVG scripts) from Firebase Storage URLs.
const ALLOWED_PROOF_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
])

async function uploadProofFile(
  dataUrl: string,
  path: string,
): Promise<string | null> {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return null
    const [, mimeType, base64] = match
    if (!ALLOWED_PROOF_MIME_TYPES.has(mimeType.toLowerCase())) {
      log.warn({ mimeType, path }, "Rejected proof upload with disallowed MIME type")
      return null
    }
    const buffer = Buffer.from(base64, "base64")
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    if (!bucketName) {
      log.error({ path }, "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set — cannot upload proof file")
      return null
    }
    const bucket = adminStorage.bucket(bucketName)
    const file = bucket.file(path)
    // Embed a Firebase download token in the object metadata.
    // This generates a stable firebasestorage.googleapis.com URL that works
    // regardless of Storage security rules and avoids makePublic() / ACL calls
    // which fail when uniform bucket-level access is enabled.
    const downloadToken = randomUUID()
    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    })
    const encodedPath = encodeURIComponent(path)
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`
  } catch (err) {
    log.error({ err, path }, "Failed to upload proof file to Storage")
    return null
  }
}

type DriverOrderStatusAction = "started" | "picked-up" | "in-transit" | "delivered" | "failed"

function buildTrackingUrl(req: Request, orderNumber: string): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_ORIGIN
  const origin = explicit || new URL(req.url).origin
  return `${origin}/track/${encodeURIComponent(orderNumber)}`
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const rateLimitResponse = await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  const { orderId } = await params
  try {
    const body = (await req.json()) as {
      driverId?: string
      status?: DriverOrderStatusAction
      photoData?: string
      signatureData?: string
      signerName?: string
      deliveryNotes?: string
      deliveryNote?: string  // legacy alias — prefer deliveryNotes
      failedReason?: string
      deliveryLat?: number
      deliveryLng?: number
    }

    const nextStatus = body.status
    const driverId = resolveDriverIdFromRequest(req, body.driverId)
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
    }
    if (!nextStatus) {
      return NextResponse.json({ ok: false, error: "status is required." }, { status: 400 })
    }
    if (!["started", "picked-up", "in-transit", "delivered", "failed"].includes(nextStatus)) {
      return NextResponse.json({ ok: false, error: "Unsupported status transition." }, { status: 400 })
    }

    // Validate proof-of-delivery payload sizes to prevent Firestore document bloat.
    // Base64 overhead is ~4/3x, so 2 MB binary ≈ 2.7 MB base64. Cap at 3 MB to stay
    // well under Firestore's 1 MB document limit once combined with other fields.
    const MAX_IMAGE_BYTES = 3 * 1024 * 1024
    const MAX_NOTE_CHARS = 2000
    if (body.photoData && body.photoData.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: "Photo exceeds maximum allowed size." }, { status: 413 })
    }
    if (body.signatureData && body.signatureData.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: "Signature exceeds maximum allowed size." }, { status: 413 })
    }
    const noteForValidation = body.deliveryNote ?? body.deliveryNotes
    if (noteForValidation && noteForValidation.length > MAX_NOTE_CHARS) {
      return NextResponse.json({ ok: false, error: "Delivery note exceeds maximum length." }, { status: 400 })
    }
    if (body.failedReason && body.failedReason.length > MAX_NOTE_CHARS) {
      return NextResponse.json({ ok: false, error: "Failed reason exceeds maximum length." }, { status: 400 })
    }
    const MAX_SIGNER_NAME_CHARS = 200
    if (body.signerName && body.signerName.length > MAX_SIGNER_NAME_CHARS) {
      return NextResponse.json({ ok: false, error: "Signer name exceeds maximum length." }, { status: 400 })
    }
    if (body.deliveryLat !== undefined || body.deliveryLng !== undefined) {
      const lat = body.deliveryLat
      const lng = body.deliveryLng
      if (
        typeof lat !== "number" || typeof lng !== "number" ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        return NextResponse.json({ ok: false, error: "Invalid delivery coordinates." }, { status: 400 })
      }
    }

    const orderRef = adminDb.collection("orders").doc(orderId)
    let order: Order | null = null
    let notificationEvent: OrderEvent | null = null
    let txnError: { status: number; message: string } | null = null

    // Atomically check the current status and apply the transition so that
    // concurrent requests (e.g. double-tap) cannot both pass the guard and
    // each send a customer notification.
    await adminDb.runTransaction(async (txn) => {
      const snap = await txn.get(orderRef)
      if (!snap.exists) {
        txnError = { status: 404, message: "Order not found." }
        return
      }

      const data = snap.data() as Record<string, unknown>
      order = { id: snap.id, ...data } as Order

      if (data.assignedDriver !== driverId) {
        txnError = { status: 403, message: "Order is not assigned to this driver." }
        return
      }

      const now = new Date()

      // ── Backward transitions (driver reverts a step) ──────────────────────
      if (nextStatus === "started") {
        if (data.status !== "picked-up") {
          txnError = { status: 409, message: "Can only revert to started from picked-up." }
          return
        }
        txn.update(orderRef, { status: "started", pickedUpAt: null, updatedAt: now })
      } else if (nextStatus === "picked-up" && data.status === "in-transit") {
        // Revert in-transit → picked-up
        txn.update(orderRef, { status: "picked-up", inTransitAt: null, updatedAt: now })
      } else if (nextStatus === "picked-up") {
        // Forward: started → picked-up
        if (data.status !== "started") {
          txnError = { status: 409, message: "Order must be in started state first." }
          return
        }
        txn.update(orderRef, { status: "picked-up", pickedUpAt: now, updatedAt: now })
      } else if (nextStatus === "in-transit") {
        if (data.status !== "picked-up") {
          txnError = { status: 409, message: "Order must be picked up first." }
          return
        }
        txn.update(orderRef, { status: "in-transit", inTransitAt: now, updatedAt: now })
        notificationEvent = "out_for_delivery"
      } else if (nextStatus === "failed") {
        const activeStatuses = ["started", "picked-up", "in-transit"]
        if (!activeStatuses.includes(data.status as string)) {
          txnError = { status: 409, message: "Cannot mark order as failed from its current state." }
          return
        }
        txn.update(orderRef, {
          status: "failed",
          failedAt: now,
          updatedAt: now,
          ...(body.failedReason ? { failedReason: body.failedReason } : {}),
        })
      } else {
        if (data.status !== "in-transit") {
          txnError = { status: 409, message: "Order must be in transit first." }
          return
        }
        txn.update(orderRef, { status: "delivered", deliveredAt: now, updatedAt: now })
        notificationEvent = "delivered"
      }
    })

    if (txnError) {
      const err = txnError as { status: number; message: string }
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status })
    }

    // Persist proof-of-delivery fields.
    // Photos and signatures are uploaded to Firebase Storage (not stored inline in
    // Firestore) to stay well under Firestore's 1 MB document limit.
    if (nextStatus === "delivered") {
      const proof: Record<string, unknown> = {}

      // Upload photo to Storage. Do NOT fall back to storing raw base64 in
      // Firestore — a mobile photo can be 500 KB–2 MB of base64, which exceeds
      // Firestore's 1 MB document limit and causes the update to silently fail.
      if (body.photoData) {
        const photoUrl = await uploadProofFile(body.photoData, `deliveries/${orderId}/photo.jpg`)
        if (photoUrl) proof.photoData = photoUrl
      }

      // Upload signature SVG. SVG data is small (~5–20 KB) so fall back to
      // base64 inline only if Storage is unavailable.
      if (body.signatureData) {
        const sigUrl = await uploadProofFile(body.signatureData, `deliveries/${orderId}/signature.svg`)
        proof.signatureData = sigUrl ?? body.signatureData
      }

      // Accept both spellings from older clients; store as deliveryNote (singular)
      const noteText = body.deliveryNotes ?? body.deliveryNote
      if (noteText) proof.deliveryNote = noteText

      if (body.signerName?.trim()) proof.signerName = body.signerName.trim()

      if (typeof body.deliveryLat === "number") proof.deliveryLat = body.deliveryLat
      if (typeof body.deliveryLng === "number") proof.deliveryLng = body.deliveryLng

      if (Object.keys(proof).length > 0) {
        // Await the update — in serverless environments a non-awaited promise is
        // killed when the response is sent, silently losing the proof data.
        await adminDb.collection("orders").doc(orderId).update(proof).catch((err) =>
          log.error({ err, orderId }, "Failed to save proof of delivery")
        )
      }
    }

    // Side-effects outside the transaction (best-effort)
    if (nextStatus === "picked-up" || nextStatus === "in-transit") {
      await adminUpdateDriver(driverId, { status: "on-delivery" }).catch(() => null)
    } else if (nextStatus === "started") {
      await adminUpdateDriver(driverId, { status: "on-delivery" }).catch(() => null)
    } else if (nextStatus === "delivered" || nextStatus === "failed") {
      await adminUpdateDriver(driverId, { status: "available" }).catch(() => null)
    }

    // Fire WhatsApp / SMS / email server-side so it doesn't depend on the
    // driver client having an admin Firebase token. Best-effort — never fails
    // the status update if notifications fail.
    if (notificationEvent && order) {
      try {
        const driver = await adminFetchDriverById(driverId).catch(() => null)
        const result = await notifyOrderEventServer(notificationEvent, {
          orderId: (order as Order).id,
          orderNumber: (order as Order).orderNumber,
          customerName: (order as Order).customerName,
          customerPhone: (order as Order).phone,
          customerEmail: (order as Order).customerEmail ?? null,
          trackingUrl: buildTrackingUrl(req, (order as Order).orderNumber),
          address: (order as Order).address,
          driverName: driver?.name ?? undefined,
          items: (order as Order).items,
        })
        log.info(
          { orderId: (order as Order).id, event: notificationEvent, result },
          "driver-triggered notifications dispatched"
        )
      } catch (err) {
        log.error({ err, orderId, event: notificationEvent }, "Failed to dispatch notifications")
      }
    }

    // Tell the Sterlin Glams store the order was delivered so it flips its own status to Delivered.
    // Best-effort; orders the store doesn't recognise are ignored there.
    if (nextStatus === "delivered" && order) {
      await notifyStoreDelivered((order as Order).orderNumber, body.signerName?.trim() || undefined)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error({ error, orderId }, "Driver order status update failed")
    return NextResponse.json({ ok: false, error: "Failed to update order status." }, { status: 500 })
  }
}
