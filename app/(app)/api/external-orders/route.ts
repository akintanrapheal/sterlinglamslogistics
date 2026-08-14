import { NextResponse } from "next/server"
import { adminCreateOrderWithId, adminOrderExists } from "@/lib/server/firestore-admin"
import { adminDb } from "@/lib/server/firebase-admin"
import { createHmac, timingSafeEqual } from "crypto"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { audit } from "@/lib/audit"

const log = createLogger("api:external-orders")
const SECRET = process.env.STORE_WEBHOOK_SECRET ?? ""

/**
 * Inbound from the Sterlin Glams store (sterlinglams.com) — a paid online DELIVERY order ready
 * for dispatch. Mirrors the WooCommerce importer, but for the new .NET platform's order shape.
 * Verifies the HMAC-SHA256 signature (base64) in `x-sg-signature` against STORE_WEBHOOK_SECRET.
 */
function verifySignature(body: string, signature: string | null): boolean {
  if (!SECRET || !signature) return false
  const expected = createHmac("sha256", SECRET).update(body, "utf8").digest("base64")
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

interface StoreOrderItem {
  name?: string
  qty?: number
  price?: number
}

interface StoreOrder {
  orderNumber?: string
  customerName?: string
  phone?: string
  customerEmail?: string | null
  address?: string
  items?: StoreOrderItem[]
  subtotal?: number
  deliveryFees?: number
  discount?: number
  amount?: number
  deliveryInstruction?: string
  paymentMethod?: string
  pickupName?: string
  pickupPhone?: string
  pickupAddress?: string
}

export async function POST(req: Request) {
  const rateLimitResponse = await checkRateLimit(getRateLimitIdentifier(req))
  if (rateLimitResponse) return rateLimitResponse

  const rawBody = await req.text()

  // Fail closed in production if the secret isn't configured.
  if (!SECRET) {
    if (process.env.NODE_ENV === "production") {
      log.error("STORE_WEBHOOK_SECRET not configured — rejecting store order push")
      return NextResponse.json({ ok: false, error: "Webhook not configured" }, { status: 503 })
    }
    log.warn("STORE_WEBHOOK_SECRET not configured — accepting unsigned push (development only)")
  } else {
    const sig = req.headers.get("x-sg-signature")
    if (!verifySignature(rawBody, sig)) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 })
    }
  }

  let so: StoreOrder
  try {
    so = JSON.parse(rawBody) as StoreOrder
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const orderNumber = (so.orderNumber ?? "").trim()
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Missing orderNumber" }, { status: 400 })
  }

  // Deduplicate — the store push is idempotent on its side too, but guard here as well.
  const orderDocId = `sg_${orderNumber}`
  if ((await adminOrderExists(orderNumber)) || (await adminDb.collection("orders").doc(orderDocId).get()).exists) {
    return NextResponse.json({ ok: true, skipped: true, message: `Order ${orderNumber} already exists` })
  }

  try {
    const now = new Date()
    const items = (so.items ?? []).map((i) => ({
      name: i.name ?? "Item",
      qty: i.qty ?? 1,
      price: Number(i.price) || 0,
    }))
    const subtotal = so.subtotal ?? items.reduce((s, i) => s + (i.price ?? 0) * (i.qty ?? 1), 0)

    const order = {
      orderNumber,
      // Pick-up From (store-supplied, with sensible defaults)
      pickupName: so.pickupName || "Sterlin Glams",
      pickupPhone: so.pickupPhone || "+234 9160009893",
      pickupAddress: so.pickupAddress || "Sterlin Glams – Ikota Ajah Lagos",
      pickupTime: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      // Deliver to
      customerName: so.customerName || "Customer",
      phone: so.phone || "",
      customerEmail: so.customerEmail || null,
      address: so.address || "No address provided",
      deliveryDate: now.toISOString().split("T")[0],
      deliveryTime: "",
      // Details
      items,
      subtotal,
      taxRate: 0,
      tax: 0,
      deliveryFees: Number(so.deliveryFees) || 0,
      deliveryTips: 0,
      discount: Number(so.discount) || 0,
      amount: Number(so.amount) || subtotal,
      deliveryInstruction: so.deliveryInstruction ?? "",
      paymentMethod: so.paymentMethod ?? "Paid online",
      status: "unassigned" as const,
      assignedDriver: null,
    }

    const id = await adminCreateOrderWithId(orderDocId, order)
    log.info({ orderId: id, orderNumber }, "Sterlin Glams store order imported")
    await audit({ action: "order.created", resourceId: id, resourceType: "order", details: { source: "sterlinglams-store", orderNumber } })

    return NextResponse.json({ ok: true, orderId: id, orderNumber })
  } catch (error) {
    log.error({ error, orderNumber }, "External order import error")
    return NextResponse.json({ ok: false, error: "Failed to create order" }, { status: 500 })
  }
}
