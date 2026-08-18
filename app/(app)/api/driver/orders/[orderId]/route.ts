import { NextResponse } from "next/server"
import { adminDb } from "@/lib/server/firebase-admin"
import { verifyDriverSession } from "@/lib/server/driver-session"
import { checkDriverApiRateLimit } from "@/lib/rate-limit"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const tokenDriverId = verifyDriverSession(req)
  if (!tokenDriverId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  // Per-driver, not per-IP — see checkDriverApiRateLimit.
  const rl = await checkDriverApiRateLimit(tokenDriverId)
  if (rl) return rl

  const { orderId } = await params

  try {
    const doc = await adminDb.collection("orders").doc(orderId).get()
    if (!doc.exists) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 })
    }
    const order = { id: doc.id, ...doc.data() }
    return NextResponse.json({ ok: true, order })
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to fetch order" }, { status: 500 })
  }
}
