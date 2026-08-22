import { NextResponse } from "next/server"
import { adminDb } from "@/lib/server/firebase-admin"

/**
 * Reports why the Firebase Admin SDK cannot reach Firestore.
 *
 * Every server-side route that touches Firestore returns a deliberately
 * generic 5xx, so a broken service-account credential, a Firestore database
 * that no longer exists and a disabled API are indistinguishable from the
 * outside — and from a driver's point of view they all read as "invalid
 * password". Diagnosing it otherwise means access to the hosting provider's
 * runtime logs.
 *
 * Output is deliberately non-sensitive: booleans, the project id (already
 * public — it ships in the client bundle), and Google's own error code. No
 * key material, no client_email, no private_key_id.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? ""
  const publicProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null

  let keyPresent = raw.length > 0
  let keyParses = false
  let keyProjectId: string | null = null
  let hasPrivateKey = false
  let privateKeyLooksWrapped = false

  if (keyPresent) {
    try {
      const start = raw.indexOf("{")
      const cleaned = (start >= 0 ? raw.slice(start) : raw).replace(/\r/g, "")
      const parsed = JSON.parse(cleaned) as Record<string, unknown>
      keyParses = true
      keyProjectId = typeof parsed.project_id === "string" ? parsed.project_id : null
      const pk = typeof parsed.private_key === "string" ? parsed.private_key : ""
      hasPrivateKey = pk.includes("BEGIN PRIVATE KEY")
      // A key stored with literal \n rather than real newlines is the single
      // most common way this breaks on hosted platforms.
      privateKeyLooksWrapped = pk.includes("\n") && !pk.includes("\n")
    } catch {
      keyParses = false
    }
  }

  let firestoreOk = false
  let firestoreError: string | null = null
  try {
    // Cheapest possible read that still proves auth and database existence.
    await adminDb.collection("drivers").limit(1).get()
    firestoreOk = true
  } catch (err) {
    const e = err as { code?: unknown; message?: string }
    // Google's codes are the useful part: 7 PERMISSION_DENIED (credential or
    // API disabled), 5 NOT_FOUND (no such database), 16 UNAUTHENTICATED.
    firestoreError = `${e.code ?? "?"}: ${(e.message ?? String(err)).slice(0, 200)}`
  }

  return NextResponse.json({
    keyPresent,
    keyParses,
    hasPrivateKey,
    privateKeyLooksWrapped,
    keyProjectId,
    publicProjectId,
    projectIdsMatch: Boolean(keyProjectId && publicProjectId && keyProjectId === publicProjectId),
    firestoreOk,
    firestoreError,
  })
}
