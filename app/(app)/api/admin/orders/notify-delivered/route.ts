import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { adminFetchOrder } from "@/lib/server/firestore-admin"
import { notifyStoreDelivered } from "@/lib/server/notify-store-delivered"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:orders:notify-delivered")

/**
 * Notify the Sterlin Glams store that an order was delivered, when it's marked delivered from an ADMIN
 * screen (Orders / Dispatch) rather than by a driver. The driver flow already calls notifyStoreDelivered
 * via /api/driver/orders/[id]/status; the admin "Mark delivered" writes Firestore directly, so without
 * this the store was never told and the order stayed on "Processing". Best-effort; the Firestore update
 * is done separately by the caller.
 */
export async function POST(req: Request) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { orderId?: string; signerName?: string }
    const orderId = body.orderId?.trim()
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 })
    }

    const order = await adminFetchOrder(orderId)
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 })
    }
    if (!order.orderNumber) {
      // No store order number (e.g. a legacy row) — nothing to notify.
      return NextResponse.json({ ok: true, notified: false })
    }

    await notifyStoreDelivered(order.orderNumber, body.signerName?.trim() || admin.email || undefined)
    log.info({ orderNumber: order.orderNumber }, "Admin-marked delivery: store notified")
    return NextResponse.json({ ok: true, notified: true })
  } catch (err) {
    log.error({ err }, "notify-delivered failed")
    return NextResponse.json({ ok: false, error: "Failed to notify store" }, { status: 500 })
  }
}
