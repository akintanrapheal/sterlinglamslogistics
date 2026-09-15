import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { adminSaveOptimizedRouteOrder } from "@/lib/server/firestore-admin"
import { createLogger } from "@/lib/logger"
import { checkAdminApiRateLimit } from "@/lib/rate-limit"

const log = createLogger("api:admin:dispatch:reorder")

export async function POST(req: Request) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { orderedIds?: string[] }
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : []
    if (orderedIds.length === 0) {
      return NextResponse.json({ ok: false, error: "orderedIds is required" }, { status: 400 })
    }

    await adminSaveOptimizedRouteOrder(orderedIds)
    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error({ error }, "Dispatch reorder failed")
    return NextResponse.json({ ok: false, error: "Failed to reorder route" }, { status: 500 })
  }
}
