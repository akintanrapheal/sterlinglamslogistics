import { createHmac } from "crypto"
import { createLogger } from "@/lib/logger"

const log = createLogger("notify-store-delivered")

/**
 * Tell the Sterlin Glams store (sterlinglams.com) that an order was delivered, so it can flip the
 * order's status to Delivered on its side. Best-effort — never throws into the caller. Signs the
 * body with HMAC-SHA256 (base64) using STORE_WEBHOOK_SECRET, sent as `x-sg-signature`.
 *
 * No-ops unless both STORE_DELIVERED_WEBHOOK_URL and STORE_WEBHOOK_SECRET are configured. Orders
 * the store doesn't recognise (e.g. legacy WooCommerce orders) are simply acked + ignored there.
 */
export async function notifyStoreDelivered(orderNumber: string, signerName?: string): Promise<void> {
  const url = process.env.STORE_DELIVERED_WEBHOOK_URL
  const secret = process.env.STORE_WEBHOOK_SECRET
  if (!url || !secret || !orderNumber) return

  try {
    const body = JSON.stringify({
      orderNumber,
      deliveredAt: new Date().toISOString(),
      ...(signerName ? { signerName } : {}),
    })
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64")

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sg-signature": signature },
      body,
    })
    if (!res.ok) {
      log.warn({ orderNumber, status: res.status }, "Store delivered callback returned non-OK")
    } else {
      log.info({ orderNumber }, "Notified store of delivery")
    }
  } catch (err) {
    log.error({ err, orderNumber }, "Failed to notify store of delivery")
  }
}
