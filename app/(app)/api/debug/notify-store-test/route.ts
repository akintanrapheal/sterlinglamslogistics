import { NextResponse } from "next/server"
import { createHmac } from "crypto"

/**
 * TEMPORARY DIAGNOSTIC — remove after use.
 *
 * Runs the exact store "delivered" callback that notifyStoreDelivered() performs, but with a DUMMY
 * order number (so it never changes a real order — the store acks unknown orders with matched:false),
 * and returns what actually happened: whether the env vars are present at runtime, the URL host, and
 * the store's HTTP status + response body. No secret value is ever returned.
 *
 * GET /api/debug/notify-store-test
 */
export async function GET() {
  const url = process.env.STORE_DELIVERED_WEBHOOK_URL
  const secret = process.env.STORE_WEBHOOK_SECRET

  const diag: Record<string, unknown> = {
    hasUrl: !!url,
    urlLen: url?.length ?? 0,
    urlHasLeadingOrTrailingSpace: url ? url !== url.trim() : false,
    urlHost: url ? (() => { try { return new URL(url).host } catch { return "INVALID_URL" } })() : null,
    hasSecret: !!secret,
    secretLen: secret?.length ?? 0,
  }

  if (!url || !secret) {
    return NextResponse.json({ ...diag, fired: false, reason: "STORE_DELIVERED_WEBHOOK_URL or STORE_WEBHOOK_SECRET missing at runtime" })
  }

  // Dummy order number — the store will not find it and will ack {ok:true, matched:false}. No real
  // order is touched. This tests connectivity + signature end to end.
  const body = JSON.stringify({ orderNumber: "__DIAG_PING__", deliveredAt: new Date().toISOString() })
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64")

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sg-signature": signature },
      body,
    })
    const text = await res.text()
    return NextResponse.json({ ...diag, fired: true, storeStatus: res.status, storeOk: res.ok, storeBody: text.slice(0, 400) })
  } catch (err) {
    return NextResponse.json({ ...diag, fired: true, fetchError: err instanceof Error ? err.message : String(err) })
  }
}
